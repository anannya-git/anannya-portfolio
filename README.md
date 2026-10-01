# Anannya Barman — Portfolio

A responsive static portfolio for Anannya Barman, Product Manager. The site uses plain HTML, CSS, and JavaScript, so GitHub Pages can publish it directly without a build step.

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
