# Deploy runbook

Production (tiny.docs.plus) deploys through the **Deploy** GitHub workflow
(`.github/workflows/deploy.yml`). It can be started by hand at any time. Once
the owner turns automatic deploys on, it also starts by itself when CI passes
on a push to `main` (a merged pull request) and deploys that commit.

## Automatic deploys

Automatic deploys are **off** until the repository variable `AUTO_DEPLOY` is
`on`. Turn them on only after the [one-time setup](#one-time-setup) is done,
including the first manual deploy (its last step). Production has had
`AUTO_DEPLOY=on` since 2026-11-17.

```bash
gh variable set AUTO_DEPLOY --body on    # turn on
gh variable set AUTO_DEPLOY --body off   # turn off (deleting the variable also turns it off)
```

When on, the workflow listens for the **CI** workflow to complete on `main`
(`workflow_run`). It deploys only when that CI run succeeded and was started
by a push; CI runs for pull requests, forks included, never deploy. GitHub
runs the copy of `deploy.yml` on `main`, so a pull request cannot change what
it does. Deploys by hand work whatever the variable says.

CI on `main` never cancels a run once it has started, so every started run
finishes and deploys its commit. Runs on `main` queue in commit order, and
GitHub keeps only one waiting run: when several pull requests merge close
together, the run already going finishes, the newest commit waits, and the
commits in between are covered by the newest one's deploy (a newer commit
includes everything before it). Deploys run one at a time, and
`scripts/deploy.sh` never moves backwards. Pull request runs are still
cancelled by a newer push to the same pull request.

While automatic deploys are off, the Deploy runs that CI starts show as
skipped. Turning them on does not deploy what merged in the meantime: deploy
by hand, or wait for the next merge.

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
5. Registers `editor-purge` with PM2, or updates it, without purging (see
   [Scheduled jobs](#scheduled-jobs)). If that fails, the run fails, but the
   new build stays live.

PM2 restarts use `ecosystem.config.cjs --only <app> --update-env`, so the env
in that file applies on every deploy. Keep production env changes in the file
on `main`, never only in the PM2 dump.

Deploys are serialised by the workflow's `deploy-production` concurrency group
and by a lock on the host. Only runs that will deploy join that group; a
skipped run gets a group of its own, so it can never cancel a deploy that is
waiting. A release that needs extra operator steps says so in its CHANGELOG
"Deploy" note. With automatic deploys on, turn them off before merging such a
release, do the steps, deploy by hand, then turn them on again.

## Scheduled jobs

Production has one, defined in `ecosystem.config.cjs` and run by PM2:

| App | Runs | What it does |
| --- | --- | --- |
| `editor-purge` | daily at 03:17, host-local time (`cron_restart: "17 3 * * *"`) | `bun scripts/purge-retention.ts`: deletes documents idle for `RETENTION_DAYS` (30) and tombstones older than `TOMBSTONE_RETENTION_DAYS` (90), as `PURGE_MODE` allows. |

- It is a job, not a server: it exits when done (`autorestart: false`), so
  `pm2 ls` shows it as `stopped` between runs. PM2 starts it again at the
  cron time.
- **Only the cron purges.** Every deploy runs `pm2 startOrRestart
  ecosystem.config.cjs --only editor-purge --update-env` to add the app or
  update its env. PM2 cannot do that without starting a run, so `deploy.sh`
  first writes a marker, `.purge-skip-next` (the time, next to `db.sqlite`).
  The run finds it, deletes it, logs `retention_purge_registered` and exits
  without reading or backing up anything. A marker older than 10 minutes is
  ignored.
- A deploy during a cron run (03:17) stops that run. The purge's batch rolls
  back and a half-written backup is never kept, so the next night's run
  simply does the work.
- Other starts do run it: `bunx pm2@6.0.14 restart editor-purge` (a run by
  hand) and `pm2 resurrect` after a host reboot.
- It shares `storageEnv` (`DB_PATH` and any retention variables) with
  `editor-next` and `editor-hocus`, so it purges the database they use with
  the same windows. Put new retention settings in `storageEnv`.
- Its output is in `bunx pm2@6.0.14 logs editor-purge`.
- After it is first started, run `bunx pm2@6.0.14 save`, so it survives a
  host reboot with the other apps.

### `PURGE_MODE`

A purge deletes documents for good. `PURGE_MODE` in the `editor-purge` env
says what a run may do:

| Value | What a run does | Log event |
| --- | --- | --- |
| `off` | nothing | `retention_purge_skipped` |
| `dry-run` (the file's value, and the default) | lists what an `on` run would delete; changes nothing | `retention_purge_dry_run` |
| `on` | backs the database up, then deletes | `retention_purge_backup_written`, then `retention_purge_completed` |

- **Dry run.** `wouldDeleteNames` (`wouldDeleteCount`) is exactly what an
  `on` run would delete now: at most 100 documents, the longest idle first.
  `staleTotal` is the whole backlog; an `on` run works through it 100 per
  run. `expiredTombstoneCount` is the tombstones it would drop.
- **Backup.** Before deleting anything, an `on` run copies the database with
  `VACUUM INTO` into `backups/` next to `DB_PATH`
  (`/opt/projects/editor.docs.plus/backups/`, git-ignored, mode 700). The
  copy is written as `*.partial` and renamed when complete. If the backup
  fails, the run logs `retention_purge_backup_failed`, exits 1 and deletes
  nothing.
  - The very first backup is `db-first.sqlite`: the state before any purge.
    It is **kept forever**, so it keeps every document the purge later
    deletes, including content taken down or deleted by its author. When a
    takedown must be complete, or once the snapshot is no longer needed,
    delete it by hand.
  - Later ones are `db-<UTC time>.sqlite`, deleted after **14 days** by age,
    not by count, so extra runs cannot push out the copies from before a
    purge.
  - Check there is room for about 16 copies of `db.sqlite` (the first, 14
    daily, and the one being written).
- **Restore** a document from a backup by copying its `documents` row back
  and deleting its `document_tombstones` row, with Hocus stopped. Restoring
  the whole file loses every edit made since the backup.
- **Turning it on.** The file shipped with `dry-run`. Production switched
  to `on` on 2026-11-22 (#138), after four daily dry runs that each listed
  the same 2 idle documents. To review runs, on the host:
  ```bash
  bunx pm2@6.0.14 logs editor-purge --lines 50 --nostream | grep retention_purge
  ```
  Over a plain `ssh host '…'` command, use `~/.bun/bin/bunx`, because a
  non-login shell doesn't have `~/.bun/bin` on `PATH`.
  When the listed documents are ones that should go, change `PURGE_MODE` to
  `on` in `ecosystem.config.cjs` in a pull request. The deploy after it merges
  updates the app (without purging); the next 03:17 run writes
  `db-first.sqlite` and does the first real purge. To stop purging,
  set `off` (or back to `dry-run`) the same way. For an immediate stop on
  the host, `bunx pm2@6.0.14 stop editor-purge`, which also stops its cron
  (the next deploy registers it again).

## CI checks and the merge queue

CI (`.github/workflows/ci.yml`) reports two checks that the `main` ruleset
(**Protect main**) requires. Their names are what the ruleset matches, so they
must not change:

| Check | Job | What it covers |
| --- | --- | --- |
| `Lint, typecheck, unit tests, build` | `checks` | audit, Biome, ESLint, typecheck, unit tests, production build, editor chunk size |
| `Playwright (Chromium)` | `e2e-gate` | passes only when the three `Playwright shard N/3` jobs and `Playwright perf (typing budget)` passed, or when the pull request changes only `docs/**` or Markdown files (outside `desktop/**`) and they were skipped |

The desktop shell workflow (`.github/workflows/desktop-shell.yml`) adds a
third check for the ruleset:

| Check | Job | What it covers |
| --- | --- | --- |
| `Desktop shell (gate)` | `gate` | passes only when `Renderer export (Linux)` and the three `Package, install and test` legs passed, or when a pull request is a draft or changes none of the shell's paths and they were skipped; in the merge queue it always builds |

The shard, perf and `Changed files` jobs are not required on their own:
`Playwright (Chromium)` always runs and fails if any of them failed, was
cancelled or was skipped when it should have run. A failing test is annotated
at its file and line on the run, and the merged HTML report is uploaded as the
`playwright-report` artifact.

### Turning the merge queue on (owner, once)

Without the queue, a pull request is only known to pass against the `main` it
last ran on. The merge queue runs CI (`merge_group` event) on `main` plus the
pull requests ahead of it, and merges only what passed. CI already runs on
`merge_group`; turning the queue on is a repository setting for an admin:

1. Settings → Rules → Rulesets → **Protect main** → Add rule →
   **Require merge queue**:
   - Merge method: **Merge commit** (what `main` uses today).
   - Build concurrency: **2** (each entry runs about seven jobs, and GitHub's
     free plan runs 20 jobs at a time across the organisation: three entries
     would take about 21, leaving nothing for pull requests).
   - Merge limits: minimum **1**, maximum **5**; wait **1 minute** to fill
     a group, so pull requests queued together usually land as one push to
     `main`, one CI run and one deploy, without holding a lone one back.
   - Only merge non-failing pull requests: on (**All green**).
   - Status check timeout: **60 minutes**.
2. In the same ruleset, keep **Require status checks to pass** with exactly
   `Lint, typecheck, unit tests, build`, `Playwright (Chromium)` and
   `Desktop shell (gate)` (source: GitHub Actions). Do not add the shard,
   perf, `Changed files`, renderer or package jobs.
3. Save, then merge pull requests with **Merge when ready** (or
   `gh pr merge <n> --auto --merge`) instead of the merge button.

Draft pull requests run the checks job only: `Playwright (Chromium)` passes
on a draft with a notice, and marking it ready for review starts the full
run. Agent sessions open their pull requests as drafts and mark them ready
when they are; a draft cannot enter the merge queue. The merge queue and
`main` always run every suite, and the gate fails if one was skipped there.

### Requiring the desktop shell (owner, once)

`Desktop shell (gate)` runs on every pull request and in the merge queue, so
it can be required. In **Protect main** → **Require status checks to pass**
→ Add checks, add `Desktop shell (gate)` (source: GitHub Actions), or with the
API:

```bash
gh api repos/docs-plus/editor/rulesets/26847251 \
  | jq '{name, target, enforcement, conditions, bypass_actors,
         rules: [.rules[] | if .type == "required_status_checks"
           then .parameters.required_status_checks += [{context:
             "Desktop shell (gate)", integration_id: 15368}]
           else . end]}' \
  | gh api -X PUT repos/docs-plus/editor/rulesets/26847251 --input -
```

Or with the API (the PUT replaces the ruleset, so this adds the rule to the
current one):

```bash
gh api repos/docs-plus/editor/rulesets/26847251 \
  | jq '{name, target, enforcement, conditions, bypass_actors,
         rules: (.rules + [{type: "merge_queue", parameters: {
           merge_method: "MERGE", grouping_strategy: "ALLGREEN",
           max_entries_to_build: 2, min_entries_to_merge: 1,
           max_entries_to_merge: 5, min_entries_to_merge_wait_minutes: 1,
           check_response_timeout_minutes: 60}}])}' \
  | gh api -X PUT repos/docs-plus/editor/rulesets/26847251 --input -
```

Notes:

- A merge queue run never deploys: its event is `merge_group` on a
  `gh-readonly-queue/main/...` branch. The push that lands the group on `main`
  runs CI again, and that run deploys.
- Any workflow later added to the required checks needs a `merge_group:`
  trigger too, or the queue waits for it until the timeout.
- To turn the queue off, delete the rule from the ruleset; the checks stay
  required.

## One-time setup

Do these in order. Automatic deploys stay off (`AUTO_DEPLOY` unset) until the
last step.

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
6. **First manual deploy.** `gh workflow run deploy.yml`, then watch it. If
   the host is already at the tip of `main`, the script finds nothing to
   fast-forward, then rebuilds and restarts both apps. It also registers
   `editor-purge` (no run; its first is the next 03:17, as a dry run): save
   the PM2 list so the job survives a reboot:
   ```bash
   ssh <user>@<host> 'cd /opt/projects/editor.docs.plus && bunx pm2@6.0.14 save'
   ```
   (That is a normal login, not the deploy key, which can only run the
   script.)
7. **Turn automatic deploys on**, only once step 6 succeeded:
   ```bash
   gh variable set AUTO_DEPLOY --body on
   ```

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

Turn automatic deploys off (`gh variable set AUTO_DEPLOY --body off`), then
delete the key's line from the host's `~/.ssh/authorized_keys` and the
`DEPLOY_SSH_KEY` secret. The workflow then fails at the SSH step.
