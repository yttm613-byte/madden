# Simple Systems

The website for Simple Systems. Plain HTML and CSS: no build step, no framework,
no tracking, no third-party requests. Open `index.html` in a browser, or put the
whole folder on any static host.

```
index.html          the page
assets/site.css     all the styling
assets/favicon.svg  browser-tab icon
demo/month-end-check.html  a working sample page (invented data)
```

Every path in the page is relative, so the folder works at the root of a domain
or inside a sub-folder.

## Contact details

**Phone:** (732) 655-8671. It appears in the top and bottom sections of
`index.html`, twice each time: as visible text, written `(732)&nbsp;655-8671`,
and in the call and text links, written `+17326558671`. To change it, replace
both forms, then check with `grep -n 655-8671 index.html`.

**Email:** `yitz@simplesystemsnj.com`.

The page wording matches the classified ad: the headline is "Your team's time
is worth more than busywork."

## Notes

- **Fonts are the visitor's own system fonts.** That is deliberate: nothing to
  download, nothing for a content filter to block, and text appears instantly.
  Headlines pick up Iowan Old Style on Apple devices and Palatino or Georgia
  elsewhere. To use a specific web font later, self-host the files in `assets/`
  and change `--serif` and `--sans` at the top of `site.css`. Nothing else
  depends on the font choice.
- **Colors** are the first block in `site.css`. The header and top section are dark navy
  (`--deep`) with a cyan-to-violet glow (`--glow`); the rest of the page is light
  (`--paper`) with solid teal buttons (`--teal`) and gradient accents (`--grad`).
- **Link preview.** The page has a title and description for link previews but no
  preview image. If you want one, add an `og:image` tag pointing at a 1200x630
  image on your domain.
- Deliberately left out: forms, popups, newsletter signups, analytics, cookies.
- **The sample page** (`demo/month-end-check.html`) is self-contained and uses only invented data: a made-up therapy agency's month-end check. It is marked `noindex`. If you don't want it, delete the file and the "See a working sample" line in the "You use it" card.
