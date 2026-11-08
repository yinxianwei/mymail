# Third-party notices

My Mail's original code is licensed under [MIT](LICENSE). Dependencies and
bundled assets retain their own copyrights and licenses.

## Interface and assets

- The interface started from [grweb](https://github.com/yinxianwei/grweb),
  maintained by the same author. The components and Gr8r tokens used here are
  included in this repository; contributors do not need a second checkout.
- Geist and Geist Mono: copyright Vercel and basement.studio, **SIL Open Font
  License 1.1**. The full notice is retained in
  [src/assets/fonts/LICENSE.txt](src/assets/fonts/LICENSE.txt).
- Lucide icons are provided by `lucide-react`; its license and attribution are
  collected from the installed package when building.
- My Mail's M/envelope logo sources live in [design/logo](design/logo/README.md)
  and are covered by this repository's MIT license.

## Application dependencies

MyGo, React, Radix, Tailwind CSS, DOMPurify, the Emersion mail libraries,
modernc SQLite and their transitive dependencies make this project possible.
The authoritative dependency versions are in [go.mod](go.mod),
[go.sum](go.sum) and [bun.lock](bun.lock).

`bun run licenses` collects the original license/notice files from installed
JavaScript packages, Go modules and bundled fonts into
`resources/licenses/THIRD_PARTY_LICENSES.txt`. Desktop builds include that directory
as an application resource. Re-run the collector after changing dependencies;
do not replace dependency licenses with this project's MIT license.
