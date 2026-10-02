# Anannya Barman — Portfolio

A responsive static portfolio for Anannya Barman, Product Manager. The site uses plain HTML, CSS, and JavaScript, so GitHub Pages can publish it directly without a build step.

A full-screen WebGL particle field sits behind the page (`script.js`). Each section names a mascot with `data-shape` (`hi`, `bars`, `rocket`, `knot`, `plane`) and a side with `data-side`; as you scroll, the particles scatter and regather into the next section's mascot. With `prefers-reduced-motion` the mascots switch without animation, and without WebGL the page falls back to a static gradient.

The intro's `hi` is a small character (it breathes, blinks, waves, hops and reacts to the cursor) that only runs while it is on screen. Sound is synthesised in the browser with Web Audio, starts on the visitor's first interaction, follows the scroll, and can be turned off with the header toggle; that choice is remembered.

## Maintaining

- **Cache versions:** `index.html` loads `styles.css?v=…` and `script.js?v=…`. Change the `v` value whenever either file changes, or returning visitors keep the cached copy. `favicon.svg?v=…` works the same way.
- **Resume:** the header button opens `Anannya_CV.pdf`. Replace that file to update it.
- **Link previews:** `og-image.jpg` (1200 × 630) is the image shown when the site is shared.
- **Favicon:** `favicon.svg` is a circle with the A cut out, black in light mode and white in dark mode.

## Preview locally

Open `index.html` in a browser, or run a local static server from this folder:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## GitHub Pages deployment

The workflow at `.github/workflows/deploy.yml` publishes the root directory to GitHub Pages whenever a commit is pushed to `main`, and supports manual runs from the Actions tab.

This site is deployed from [`anannya-git/anannya-portfolio`](https://github.com/anannya-git/anannya-portfolio). GitHub Pages is configured to use **GitHub Actions**, and the deploy workflow runs automatically when changes reach `main`. The custom domain `anannya.in` is configured in the repository's Pages settings.

## Connect `anannya.in` at GoDaddy

After GoDaddy completes registrant verification and unlocks DNS editing, point the apex domain to GitHub Pages with these A records:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

For `www`, set the CNAME target to `anannya-git.github.io`. Replace only conflicting `@` A and `www` CNAME records; preserve unrelated records such as email MX and TXT records. Once DNS resolves, enable **Enforce HTTPS** under **Settings → Pages** if GitHub has not enabled it automatically.
