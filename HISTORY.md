# Development history

The standalone public repository began with an October 3, 2026 snapshot. It also contains 10 filtered development commits from February 15 through October 3, 2026. Their author and committer dates come from the original repository; they describe development dates, not earlier public releases.

The retained history covers the nineteen original figure, helper, data, and test files listed in `provenance.json`. It includes the stable-matching simulator, Odyssey map, job-search simulator, and Trick or Treat route planner. The standalone Vite gallery, fonts, screenshots, and extraction adaptations belong to the October 3 public snapshot.

Historical files are relocated under `src/figures/` without content changes. Commit messages describe the retained figure changes; unrelated site work is omitted. Historical snapshots retain their original site imports and client directives. The matching completion fix and Odyssey layout adaptation remain in the October 3 standalone snapshot.

Each imported commit changes a retained file. Commits outside that scope and merges with no additional retained changes are omitted. Original author and committer identities and timestamps are preserved. Filtering changes commit IDs; [history-map.json](history-map.json) maps every retained source commit to its imported counterpart.

The import joins the historical branch to the existing public history with an October 3 merge. Existing public commits and the current code remain intact. Older snapshots may depend on parts of the original application that are outside this extraction; they were inspected as history, not built or tested as standalone packages.

[Browse the imported history](https://github.com/AndrewFribush/interactive-figures/commits/af380c6604591d14e4028da1e2b09a3590bd95c9). The extraction provenance describes the current runnable package.
