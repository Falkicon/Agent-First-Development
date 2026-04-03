# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

When you make a change that should be released, run:

```bash
pnpm changeset
```

This creates a changeset file describing the change and its semver impact.
At release time, `pnpm changeset version` consumes all changesets, bumps versions,
and updates CHANGELOG.md automatically.

All `@lushly-dev/*` packages use **fixed versioning** — they always share the same version number.

Changesets only version the published npm packages in this monorepo.

- If you changed one or more `@lushly-dev/*` packages, add a changeset.
- If you changed only `python/` or docs/skills, do not add a no-op changeset.
- Track Python-only work in `CHANGELOG.md`, then release it through the `python-v*`
  tag / `publish-python.yml` flow after bumping `python/pyproject.toml`.
