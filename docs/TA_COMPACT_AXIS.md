# Compact technical pane axes

Actual browser reviews of the frozen native adapters found meaningless fallback ticks in empty 30 px
collapsed strips: Lightweight displayed `0.00`, and KLine displayed `6.000000`. Neither value
existed in the controlled input data. This is an axis-label defect, not a computed output.

Collapsed Lightweight panes now use transparent right-axis tick text and restore the current theme
text color on expansion. The native range and axis width remain intact. KLine technical panes use a
public registered axis whose inherited numeric range and conversion methods remain unchanged; only
tick creation returns an empty list at the 30 px collapsed height. Expanded panes retain the native
ticks. The candle price axis and legacy volume pane are not replaced.

`test/technical-compact-axis.test.mjs` verifies both transitions, unchanged main-axis options,
unchanged numeric data, and the installed KLine axis inheritance. The targeted native suites pass
67/67. Source TypeScript is checked with only the two generated version declarations supplied in
memory. These method-level checks do not prove actual browser paint; the follow-up visual gate must
inspect collapsed and expanded panes, both themes and native engines, including the absence of
fallback text and preservation of the camera and main price scale.
