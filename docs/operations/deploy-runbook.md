# Deploy runbook

Production (tiny.docs.plus) deploys through the **Deploy** GitHub workflow
(`.github/workflows/deploy.yml`). It starts by itself when CI passes on a push
to `main` (a merged pull request) and deploys that commit. It can also be
started by hand.

## Automatic deploys

The workflow listens for the **CI** workflow to complete on `main`
(`workflow_run`). It deploys only when that CI run succeeded and was started
by a push; CI runs for pull requests, forks included, never deploy. GitHub
runs the copy of `deploy.yml` on `main`, so a pull request cannot change what
it does.

CI on `main` cancels a run when a newer push arrives, so when several pull
requests merge close together, only the last one's CI finishes and deploys.
Deploys run one at a time, and a newer commit includes everything before it.

**Kill switch.** Pause automatic deploys with a repository variable; deploys
by hand keep working:

```bash
gh variable set AUTO_DEPLOY --body off   # pause
gh variable delete AUTO_DEPLOY           # resume (any value but "off" also resumes)
```

While paused, the Deploy runs that CI starts show as skipped. Resuming does
not deploy what merged in the meantime: deploy by hand, or wait for the next
merge.

## Deploying by hand

```bash
gh workflow run deploy.yml                 # deploy the tip of main
gh workflow run deploy.yml -f ref=<sha>    # deploy a specific commit of main
gh run watch "$(gh run list --workflow deploy.yml -L1 --json databaseId --jq '.[0].databaseId')"
```

Or use GitHub: Actions → Deploy → Run workflow.

## What a deploy does

The workflow:

1. Resolves the commit and refuses it unless it is on `main` and its `ci.yml`
   run on `main` passed. If that run is still going, it waits for it.
2. Connects over SSH with a key that can only run `scripts/deploy.sh`.

On the host, `scripts/deploy.sh`:

1. Refuses anything but a full commit SHA. It also refuses a commit that is
   not on `origin/main`, a live checkout with local changes, or a commit
   older than the one deployed. It only moves forward.
2. Builds Next.js in a second checkout (`../editor-build`) while the site keeps
   serving. If the build fails, nothing is restarted.
3. Fast-forwards the live checkout, runs `bun install --frozen-lockfile`,
   restarts `editor-hocus` from `ecosystem.config.cjs` and waits for port 3848.
4. Swaps the new `.next` in (the old one becomes `.next.prev`), restarts
   `editor-next` and waits for port 3847 to answer. If it doesn't, the old
   build goes back.
5. Starts or restarts `editor-purge` (see [Scheduled jobs](#scheduled-jobs)),
   which runs the retention purge once. If that fails, the run fails, but the
   new build stays live.

PM2 restarts use `ecosystem.config.cjs --only <app> --update-env`, so the env
in that file applies on every deploy. Keep production env changes in the file
on `main`, never only in the PM2 dump.

Deploys are serialised by the workflow's concurrency group and by a lock on the
host. A release that needs extra operator steps says so in its CHANGELOG
"Deploy" note. With automatic deploys, pause them (`AUTO_DEPLOY=off`) before
merging such a release, do the steps, deploy by hand, then resume.

## Scheduled jobs

Production has one, defined in `ecosystem.config.cjs` and run by PM2:

| App | Runs | What it does |
| --- | --- | --- |
| `editor-purge` | daily at 03:17, host-local time (`cron_restart: "17 3 * * *"`) | `bun scripts/purge-retention.ts`: deletes documents idle for `RETENTION_DAYS` (30) and tombstones older than `TOMBSTONE_RETENTION_DAYS` (90). |

- It is a job, not a server: it exits when done (`autorestart: false`), so
  `pm2 ls` shows it as `stopped` between runs. PM2 starts it again at the
  cron time.
- Every deploy runs `pm2 startOrRestart ecosystem.config.cjs --only
  editor-purge --update-env`, which also runs one purge straight away. The
  purge is safe to run again.
- It shares `storageEnv` (`DB_PATH` and any retention variables) with
  `editor-next` and `editor-hocus`, so it purges the database they use with
  the same windows. Put new retention settings in `storageEnv`.
- Its output (`retention_purge_completed` with the deleted names) is in
  `bunx pm2@6.0.14 logs editor-purge`.
- Run it by hand: `bunx pm2@6.0.14 restart editor-purge`.
- After it is first added, run `bunx pm2@6.0.14 save`, so it survives a host
  reboot with the other apps.

## One-time setup

0. **Check the host.** Run these on the host from a plain SSH command, not an
   interactive login, because the forced command doesn't get a login shell:
   ```bash
   ssh <user>@<host> 'command -v bun git flock curl; git -C /opt/projects/editor.docs.plus remote -v'
   ssh <user>@<host> 'git -C /opt/projects/editor.docs.plus fetch --dry-run origin main && echo fetch-ok'
   ```
   - `bun` must resolve (the script adds `~/.bun/bin` to PATH).
   - The fetch must work without your SSH agent. A public HTTPS `origin` does.
   - Every deploy restarts both apps with `--update-env` from
     `ecosystem.config.cjs`, so compare what the running apps have with the
     file and move anything missing into the file on `main` first:
     ```bash
     bunx pm2@6.0.14 env 4   # editor-hocus
     bunx pm2@6.0.14 env 2   # editor-next
     ```

1. **Deploy key**, on your own machine. It needs no passphrase and is used for
   nothing else:
   ```bash
   ssh-keygen -t ed25519 -N "" -C tinydocy-deploy -f ~/.ssh/tinydocy_deploy
   ```
2. **Authorise it on the host**, for the user that owns
   `/opt/projects/editor.docs.plus` and runs PM2. The `restrict,command=…`
   prefix limits the key to the deploy script:
   ```bash
   echo "restrict,command=\"/opt/projects/editor.docs.plus/scripts/deploy.sh\" $(cat ~/.ssh/tinydocy_deploy.pub)" \
     | ssh <user>@<host> 'cat >> ~/.ssh/authorized_keys'
   ```
   The host also needs `flock` and `curl` (both standard on Ubuntu).
3. **The host key** for strict host checking. Check its fingerprint against
   the server's own (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the
   host):
   ```bash
   ssh-keyscan -t ed25519 <host> > /tmp/tinydocy_known_hosts
   ssh-keygen -lf /tmp/tinydocy_known_hosts
   ```
4. **GitHub environment and secrets** (repository admin). Until they exist,
   every merge to `main` starts a Deploy run that fails at the SSH step, so
   pause automatic deploys first (`gh variable set AUTO_DEPLOY --body off`)
   and resume after step 6:
   ```bash
   gh api -X PUT repos/docs-plus/editor/environments/production
   gh secret set DEPLOY_HOST --env production --body "<host>"
   gh secret set DEPLOY_USER --env production --body "<user>"
   gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/tinydocy_deploy
   gh secret set DEPLOY_KNOWN_HOSTS --env production < /tmp/tinydocy_known_hosts
   # only if SSH is not on port 22:
   gh secret set DEPLOY_PORT --env production --body "<port>"
   ```
   Then allow only `main` to deploy to it, so a workflow edited on another
   branch can never read these secrets:
   ```bash
   gh api -X PUT repos/docs-plus/editor/environments/production \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/docs-plus/editor/environments/production/deployment-branch-policies \
     -f name=main -f type=branch
   ```
   (Or in Settings → Environments → production → Deployment branches and tags.)
   Adding required reviewers there makes every deploy wait for approval in
   GitHub.
5. **Bring the script onto the host once.** The forced command runs
   `scripts/deploy.sh` from the live checkout, which only has it after it
   is pulled. Pull once by hand, with no install or restart. Hocus keeps
   running from memory, and Next.js keeps serving `.next`:
   ```bash
   ssh <user>@<host> 'cd /opt/projects/editor.docs.plus && git pull --ff-only'
   ```
   Changes to `deploy.sh` always take effect on the deploy after the one that
   pulls them in.
6. **Test it.** `gh workflow run deploy.yml`. If the host is already at the
   tip of `main`, the script finds nothing to fast-forward, then rebuilds and
   restarts both apps. Then resume automatic deploys
   (`gh variable delete AUTO_DEPLOY`).

## Rollback

- **Next.js only:** on the host, swap the builds and restart:
  ```bash
  cd /opt/projects/editor.docs.plus
  mv .next .next.bad && mv .next.prev .next && bunx pm2@6.0.14 restart editor-next
  ```
- **Code:** revert the change on `main` with a pull request, then run the
  workflow again. The script never moves the checkout backwards.
- **Schema:** never roll back below the client schema floor; see
  `docs/operations/schema-rollout-runbook.md`.

## Revoking

Pause automatic deploys (`gh variable set AUTO_DEPLOY --body off`), then
delete the key's line from the host's `~/.ssh/authorized_keys` and the
`DEPLOY_SSH_KEY` secret. The workflow then fails at the SSH step.
