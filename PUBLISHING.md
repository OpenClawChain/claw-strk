# Publishing to npm

## Prerequisites

1. You need an npm account. Create one at https://www.npmjs.com/signup
2. Login to npm from your terminal:
   ```bash
   npm login
   ```

## Publishing Steps

### First Time Publishing

1. **Build the package:**
   ```bash
   pnpm build
   ```

2. **Verify the package contents:**
   ```bash
   npm pack --dry-run
   ```
   This shows what files will be included in the package.

3. **Publish to npm:**
   ```bash
   npm publish --access public
   ```
   Note: Scoped packages (@openclawchain/claw-strk) are private by default, so you need `--access public`.

### Subsequent Updates

1. **Update the version** in package.json (follow semver):
   - Patch: `0.1.0` → `0.1.1` (bug fixes)
   - Minor: `0.1.0` → `0.2.0` (new features, backward compatible)
   - Major: `0.1.0` → `1.0.0` (breaking changes)

2. **Build and publish:**
   ```bash
   pnpm build
   npm publish
   ```

## Verification

After publishing, verify at:
https://www.npmjs.com/package/@openclawchain/claw-strk

Users can then install with:
```bash
npm install -g @openclawchain/claw-strk
# or
pnpm add -g @openclawchain/claw-strk
```

## Notes

- The `prepublishOnly` script automatically runs `pnpm build` before publishing
- The `files` field in package.json controls what gets published
- Make sure `.env` is in `.gitignore` (it is) so secrets don't get published
