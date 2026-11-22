# Notices for this modified distribution

This is an unofficial modified distribution of Overleaf Community Edition and
Overleaf Extended Community Edition (CE+). It is not an official Overleaf release
and is not endorsed by Overleaf or the upstream CE+ maintainers.

## Upstream works

- Overleaf Community Edition: https://github.com/overleaf/overleaf
  - Comparison base: `e039ad26c5bf5422eb57b89fc7e57c75055e631d`.
  - Copyright (c) Overleaf, 2014–2026. Individual notices remain in their files.
- Overleaf Extended Community Edition: https://github.com/yu-i-i/overleaf-cep
  - Integrated revision: `ae07e781ab20dac2378420e5cf7a47f7d8bccbb5` (`ext-ce`).
  - Copyright (c) @yu-i-i, @davrot, 2024–2026, for CE extensions.
  - Further adapted-code acknowledgments are retained in [CREDITS.md](CREDITS.md).

## Local modifications and dates

Local modifications made on 2026-11-08 include Japanese/full TeX Live build
support, self-hosting Compose definitions, a local LLM translation service and
editor integration, and per-main-document PDF/log caching. Translation updates on
that date include connection settings, project prompts, partial-result handling,
and validation/retry improvements.

Changes on 2026-11-09 include deployment/migration documentation, restoration
configuration, Docker build-context exclusions, a TeX Live build-argument scope
fix, host LLM connection support, and publication/licensing notices and settings.
Translation corrections on that date also protect comment/definition line endings
and validate each chunk's LaTeX structure before accepting it, allowing structural
errors to enter the existing bounded retry path rather than discarding translations
only after the whole document has finished.
Fixed translation guardrails also prohibit newly introduced math/commands even
when project-specific style instructions replace the default style prompt.
Authors and individual changes are recorded in Git history; uncommitted work must
be committed before a release is identified by its revision.

## License and third-party material

The modified Overleaf work and local additions are provided under the GNU Affero
General Public License, version 3; see [LICENSE](LICENSE). This statement does not
replace third-party licenses or resolve conflicting upstream metadata. Individual
license/copyright notices, font licenses, and dependency terms must be retained.
The unresolved items and the publication requirements are documented in
[docs/LICENSE_REVIEW.md](docs/LICENSE_REVIEW.md).

The software is provided without warranty to the extent permitted by applicable
law, as set out in LICENSE. Recipients may modify and redistribute the covered
work under that license. Software licenses do not themselves grant permission to
use another party's trademarks or imply endorsement.

## Source availability

Operators of a network-accessible modified instance must prominently offer its
users the corresponding source of that deployed version, free of charge, as
required by AGPLv3 section 13. A link only to the unmodified upstream repository
does not provide these local modifications. Distributors of executable images
must also comply with the applicable source-delivery requirements.

The operator/publisher must supply the actual release source URL. No public fork
URL has been configured or verified by this notice. Credentials, user projects,
databases, and private backups are not the release source package.
