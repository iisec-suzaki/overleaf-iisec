// Read package license metadata in the built Overleaf image without starting it.
// This is an inventory, not a determination of license compliance.
// See docs/LICENSE_REVIEW.md for invocation and limitations.
// Local addition, 2026-11-09; GNU AGPL version 3, see ../LICENSE.
const fs = require('node:fs')
const path = require('node:path')
const pnp = require('/overleaf/.pnp.cjs')

const records = new Map()
const unavailable = []
for (const locator of pnp.getAllLocators()) {
  const info = pnp.getPackageInformation(locator)
  if (!info?.packageLocation) continue
  const location = info.packageLocation
  let metadata
  try {
    metadata = JSON.parse(
      fs.readFileSync(path.join(location, 'package.json'), 'utf8')
    )
  } catch (error) {
    // PnP also lists optional packages for platforms absent from this image.
    // Keep them visible rather than treating them as checked packages.
    if (error.code !== 'ENOENT') throw error
    unavailable.push({
      name: locator.name,
      reference: locator.reference,
      reason: 'package.json not present in image',
    })
    continue
  }
  const record = {
    name: metadata.name || locator.name,
    version: metadata.version || null,
    license: metadata.license || metadata.licenses || null,
    workspace: locator.reference.includes('workspace:'),
    noticeFiles: fs
      .readdirSync(location)
      .filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))
      .sort(),
  }
  records.set(`${record.name}@${record.version}`, record)
}
const inventory = [...records.values()].sort((a, b) =>
  a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version))
)
process.stdout.write(
  JSON.stringify({ packages: inventory, unavailable }, null, 2) + '\n'
)
