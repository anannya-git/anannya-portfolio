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

1. Create a GitHub repository and push these files to its `main` branch.
2. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Wait for the **Deploy portfolio to GitHub Pages** workflow to finish. GitHub will show the Pages URL in the workflow deployment environment.
4. Under **Custom domain**, enter `anannya.in` and save. With a custom GitHub Actions publishing workflow, GitHub stores this setting in Pages; the included `CNAME` file is harmless but not required.

## Connect `anannya.in` at GoDaddy

In GoDaddy DNS management, point the apex domain to GitHub Pages with these A records:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

For `www`, add a CNAME record with **Name** `www` and **Value** `<your-github-username>.github.io` (replace the placeholder with the GitHub Pages host shown for your account). Remove only DNS records that conflict with these hostnames; keep unrelated records, such as email MX records, intact. After DNS resolves, enable **Enforce HTTPS** under **Settings → Pages**.

The site and workflow are prepared here, but GitHub repository publishing and GoDaddy DNS changes require access to those accounts.
