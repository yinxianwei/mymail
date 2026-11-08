# Publishing and releasing / 发布流程

## Repository launch

The target is `github.com/yinxianwei/mymail`, licensed under MIT. Local
preparation does not create a GitHub repository, change visibility or publish
a release. Before the first push:

1. Review the source and **Git history** for private data. The automated scan
   detects many known secret patterns; it cannot prove the absence of every
   secret or private email. Rotate any exposed credential before publishing.
2. Create an empty repository on GitHub, with no generated README or license,
   then add it as `origin` and push the reviewed branch. Avoid mixing a second
   independently initialized history with this one.
3. Set the default branch to `main`. Run the workflows once and inspect results.
4. Set repository description, topics and social preview using the suggestions
   in [LAUNCH.md](LAUNCH.md).
5. Enable private vulnerability reporting, secret scanning/push protection and
   dependency alerts in GitHub settings where available. The private reporting
   link in `.github/SECURITY.md` needs the repository setting to be enabled.
6. Protect `main` with required PR checks: **Repository checks**, **Frontend tests
   and build**, **macOS tests and package**, and **Scan Git history for secrets**.
   Configure these after the check names have appeared on the first run.
7. Enable Issues. Discussions are optional; there are no automatic messages,
   auto-merges, forced stars, sponsorship links or promotion bots.

## Checks

```sh
bun install --frozen-lockfile
python3 scripts/check-repository.py
go vet ./...
bun run test
bun run build:web
MYMAIL_SIGN=- bun run build -platform darwin/arm64
```

The CI workflow validates repository links/metadata/workflow syntax, tests the
frontend on Linux, and tests/builds the native app on macOS. Dependency updates
arrive as weekly Dependabot PRs and need normal review. Actions use full commit
SHAs, PR checks run with read-only repository permissions, checkout does not
persist credentials, and no signing secrets are required.

The secret-scan workflow uses the pinned Gitleaks CLI against fetched Git
history on PRs, main-branch pushes and weekly runs. Output is redacted. For a
local scan, use the same command in `.github/workflows/security.yml`; uncommitted
files need a separate directory scan before they are committed.

## Create a preview

1. Update **both** `package.json` and `mygo.config.ts` to the same version. Keep
   the Go/Bun/MyGo versions consistent with the lockfiles and CI. Record the
   change in [CHANGELOG.md](../CHANGELOG.md).
2. Test the built app using a separate local demo directory. Confirm launch,
   folders, light/dark themes, compose, attachments and quit behavior. Real
   provider acceptance is a separate, deliberate check.
3. Commit and push the reviewed changes. Create an annotated tag matching the
   package version, for example `v0.0.1`, **only when ready**. Push that tag.
4. `Release preview` runs repository/secret/test checks and builds an ad-hoc
   signed Apple Silicon DMG. A mismatched tag/version fails before packaging.
5. The workflow creates a **draft prerelease** with a DMG, `SHA256SUMS`, the
   project license and collected third-party licenses. It never publishes it
   automatically. No additional PAT or Apple certificate is needed for this
   preview workflow; it uses GitHub's job token for the draft release.
6. Download the draft assets, verify the hash and test the installation. Edit
   release notes for the actual version, then publish the preview manually.

Do not move a published version tag or overwrite an existing release to retry.
If a draft already exists and a job fails/re-runs, inspect it first; the workflow
intentionally does not overwrite existing assets or a published release.

## Signing boundary

Ad-hoc signing is not a trusted public distribution identity and does not imply
notarization. Automated previews say this explicitly in README/install/release
notes. A Developer ID + Apple notarization distribution pipeline remains future
work. Do not upload local keychains, exported certificates, app passwords or
Apple credentials into the repository. Signing credentials, if later added,
belong in protected GitHub environments/secrets, not fork PR jobs.

## References

- [GitHub-hosted runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Draft releases and GitHub CLI](https://cli.github.com/manual/gh_release_create)
- [Dependabot ecosystem support, including Bun](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)

中文：先审查源文件与历史，再推送。首次工作流运行后，配置分支保护和私密漏洞报告。版本标签触发的流程只生成草稿预览；检查安装包与说明后再手动公开，不能把 CI 成功说成真实服务商或所有平台都验收通过。
