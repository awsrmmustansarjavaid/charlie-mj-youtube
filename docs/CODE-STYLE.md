[← Main README](../README.md) · [Documentation index](README.md)

# Code Style

All source files in `src/` follow one readable, maintainable style.

## Formatting
- [Prettier](https://prettier.io) with `--print-width 100`; no minified or single-line code.
- JavaScript: 2-space indent, double quotes, semicolons, one statement per line.
- HTML: one attribute group per tag, nested elements indented; BEM-like class names (`card`, `card__title`, `card--featured`).
- CSS: one declaration per line, sections separated by comment banners.

```html
<div class="card card--featured">
  <h2 class="card__title">Featured Product</h2>
  <p class="card__description">
    Lorem ipsum dolor sit amet, consectetur adipiscing elit.
  </p>
  <a href="#" class="card__link">Learn More</a>
</div>
```

Format everything before packaging:

```bash
prettier --print-width 100 --write "src/**/*.{js,css,html}" manifest.json
```

## Comments
- Every file starts with a header comment: what it is and what it owns.
- Every named function has a one-line JSDoc (`/** … */`) describing what it does.
- Complex steps (for example the Compare summary) have short block comments explaining *why*.

## Validation
`node --check <file>` for every JavaScript file, then `node scripts/validate.mjs`.

---
[← Main README](../README.md) · [Documentation index](README.md)
