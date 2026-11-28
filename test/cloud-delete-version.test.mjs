import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function elements(value, type) {
  if (Array.isArray(value)) return value.flatMap(x => elements(x, type));
  if (!value || typeof value !== "object") return [];
  return [...(value.type === type ? [value] : []), ...elements(value.props?.children, type)];
}
function fixture(deletion = {kind:"previous", allowed:true}) {
  let confirming = false;
  const calls = [], load = sourceModules({ "react/jsx-runtime":jsx,
    react:{ useState: () => [confirming, value => { confirming = value; }] }
  });
  load("i18n/preferences.ts").setDisplayPreferences({locale:"en"});
  const {CloudDeleteVersion} = load("screens/terminal/CloudDeleteVersion.tsx");
  const render = (patch={}) => CloudDeleteVersion({ id:"12345678-reviewed", deletion, busy:false, blocked:false,
    onDelete:id=>calls.push(id), ...patch });
  return {render,calls};
}
test("deletion requires a separate confirmation and cancellation has no effect", () => {
  const f=fixture();
  elements(f.render(),"button")[0].props.onClick();
  assert.deepEqual(f.calls,[]);
  let buttons=elements(f.render(),"button");
  assert.equal(buttons.length,2);
  buttons[1].props.onClick();
  assert.deepEqual(f.calls,[]);
  elements(f.render(),"button")[0].props.onClick();
  buttons=elements(f.render(),"button");
  buttons[0].props.onClick();
  assert.deepEqual(f.calls,["12345678-reviewed"]);
});
test("protected current and busy/blocked controls cannot offer an enabled destructive action", () => {
  const f=fixture({kind:"current",allowed:false,reason:"last-head"});
  assert.equal(elements(f.render(),"button").length,0);
  const allowed=fixture();
  assert.equal(elements(allowed.render({busy:true}),"button")[0].props.disabled,true);
  assert.equal(elements(allowed.render({blocked:true}),"button")[0].props.disabled,true);
});
