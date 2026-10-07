# Simple Systems

The website for Simple Systems. Plain HTML and CSS: no build step, no framework,
no tracking, no third-party requests. Open `index.html` in a browser, or put the
whole folder on any static host.

```
index.html          the page
assets/site.css     all the styling
assets/favicon.svg  browser-tab icon
```

Every path in the page is relative, so the folder works at the root of a domain
or inside a sub-folder.

## Before it goes live

**Phone number.** `[PHONE]` is a placeholder. It appears in six places in
`index.html`: the visible button text and the call and text links, in the top
section and again in the bottom one. This swaps all of them at once. Use your
real number in place of the example (links first, then the visible text):

```bash
cd simple-systems
sed -i 's#tel:\[PHONE\]#tel:+17325550100#g; s#sms:\[PHONE\]#sms:+17325550100#g; s#\[PHONE\]#(732) 555-0100#g' index.html
grep -c 'PHONE' index.html   # prints 0 when nothing is left
```

**Email.** `yitz@simplesystemsnj.com` is already in place.

## Notes

- **Fonts are the visitor's own system fonts.** That is deliberate: nothing to
  download, nothing for a content filter to block, and text appears instantly.
  Headlines pick up Iowan Old Style on Apple devices and Palatino or Georgia
  elsewhere. To use a specific web font later, self-host the files in `assets/`
  and change `--serif` and `--sans` at the top of `site.css`. Nothing else
  depends on the font choice.
- **Colors** are the first block in `site.css` (`--teal`, `--slate`, `--paper`).
- **Link preview.** The page has a title and description for link previews but no
  preview image. If you want one, add an `og:image` tag pointing at a 1200x630
  image on your domain.
- Deliberately left out: forms, popups, newsletter signups, analytics, cookies.
