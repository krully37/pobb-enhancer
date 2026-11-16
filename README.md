# Pobb Enhancer

A Firefox and Chrome extension for [pobb.in](https://pobb.in): click any item, jewel or gem on a Path of Exile 1 build and get a pathofexile.com/trade search with its modifiers filled in.

## What a click does

| You click | The trade search gets |
|---|---|
| **Rare / magic item** | Base type, plus every implicit, explicit, crafted and fractured mod in one **count** group (min = all mods), each at ≥ 90% of the build's roll |
| **Unique** | Name and base, plus only the mods with variable rolls (and the variant-picked lines on Megalomaniac, Watcher's Eye, and similar uniques) |
| **Cluster jewel** | Passive count, jewel sockets and the small-passive enchant as **required, exact** filters; notables and "also grant" lines in the count group |
| **Timeless jewel** | The leader and its exact seed (any seed when the jewel was made in PoB), plus the devotion line |
| **Gem** | Gem name (transfigured gems handled), level ≥ and quality ≥; marked corrupted when level or quality is above the cap |

It also adds:

- Influences (required).
- Searing Exarch and Eater of Worlds items, and Synthesised items.
- Corrupted state.
- 5- or 6-link sockets.
- Enchants, added but unchecked (except on cluster jewels).

To loosen a search, lower the count group's minimum on the trade page.

- **Plain click** opens the search in a new tab.
- **Middle click** opens it in a background tab.
- **Ctrl+click** still does what pobb.in does (opens the wiki).

A toast in the corner shows the league, how many mod lines matched, and any line that has no trade stat (for example skill-specific helmet enchants).

PoE 2 builds are not supported yet; the extension stays inactive on them.

## Options

Open them from the extension's entry in your browser's add-ons page.

- **League:** Auto picks the current softcore trade league from the trade API. You can also pick one by hand.
- **Listings:** Instant Buyout and In Person (default), Instant Buyout only, In Person only, or Any.
- **Minimum roll:** the percentage of the build's roll used as the minimum (default 90).
- **Mods allowed to be missing:** count group min = N − this value (default 0).

## Development

Needs Node 22 or newer. There are no runtime or dev dependencies.

```bash
npm test              # unit + fixture tests (real pobb.in builds in test/fixtures)
npm run build         # dist/firefox, dist/chrome, and store zips
npm run update-data   # refresh stat/item data from Awakened PoE Trade (do this each league)
```

To load the extension locally:

- **Firefox:** open `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `dist/firefox/manifest.json`
- **Chrome / Edge:** open `chrome://extensions` → enable Developer mode → *Load unpacked* → `dist/chrome`

### How it works

1. On a pobb.in build page, the content script fetches `https://pobb.in/<id>/xml`, the build's Path of Building XML.
2. When you click an item image, it matches pobb.in's rendered item images to the active item set and tree (pobb.in lets viewers switch sets, so it picks the set that matches what's on screen).
3. It sends that item's text to the background script.
4. The background script matches each mod line to a trade stat ID using Awakened PoE Trade's stat dataset, including local vs global mods, multi-line stats, and option-based stats like cluster enchants.
5. It builds the query and opens `https://www.pathofexile.com/trade/search/<league>?q=<query>`.

The only network requests are:

- the build XML from pobb.in;
- the league list from `www.pathofexile.com/api/trade/data/leagues`, cached for 6 hours.

Nothing is collected or sent anywhere else.

## Publishing

`npm run build` produces:

- `dist/pobb-enhancer-firefox-<version>.zip`: upload to [addons.mozilla.org](https://addons.mozilla.org/developers/).
- `dist/pobb-enhancer-chrome-<version>.zip`: upload to the [Chrome Web Store](https://chrome.google.com/webstore/devconsole).
- `dist/pobb-enhancer-source-<version>.zip`: give this to AMO if it asks for source code. There is no minification; the build only copies files and generates `content-lib.js` from `src/lib/`.

## Credits

- Stat and item data, and the stat-matching approach, come from [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) (MIT).
- Build data comes from [pobb.in](https://pobb.in).

This is a fan project, not affiliated with or endorsed by Grinding Gear Games or pobb.in.

## License

MIT. See [LICENSE](LICENSE).
