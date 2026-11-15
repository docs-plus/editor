# Deploy runbook

Production (tiny.docs.plus) deploys through the **Deploy** GitHub workflow
(`.github/workflows/deploy.yml`). It is started by hand after a pull request
merges and CI on `main` is green; nothing deploys on merge by itself.

## Running a deploy

```bash
gh workflow run deploy.yml                 # deploy the tip of main
gh workflow run deploy.yml -f ref=<sha>    # deploy a specific commit of main
gh run watch "$(gh run list --workflow deploy.yml -L1 --json databaseId --jq '.[0].databaseId')"
```

Or use GitHub: Actions → Deploy → Run workflow.

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

PM2 restarts use `ecosystem.config.cjs --only <app> --update-env`, so the env
in that file applies on every deploy. Keep production env changes in the file
on `main`, never only in the PM2 dump.

Deploys are serialised by the workflow's concurrency group and by a lock on the
host. A release that needs extra operator steps says so in its CHANGELOG
"Deploy" note; do those by hand before or after, as the note says.

## One-time setup

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
4. **GitHub environment and secrets** (repository admin):
   ```bash
   gh api -X PUT repos/docs-plus/editor/environments/production
   gh secret set DEPLOY_HOST --env production --body "<host>"
   gh secret set DEPLOY_USER --env production --body "<user>"
   gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/tinydocy_deploy
   gh secret set DEPLOY_KNOWN_HOSTS --env production < /tmp/tinydocy_known_hosts
   # only if SSH is not on port 22:
   gh secret set DEPLOY_PORT --env production --body "<port>"
   ```
   Adding required reviewers to the `production` environment makes every
   deploy wait for approval in GitHub.
5. **Test it.** `gh workflow run deploy.yml` with the commit already
   deployed: the script finds nothing to fast-forward, rebuilds, and restarts
   both apps.

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

Delete the key's line from the host's `~/.ssh/authorized_keys` and the
`DEPLOY_SSH_KEY` secret. The workflow then fails at the SSH step.
