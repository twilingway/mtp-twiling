import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { Drawing } from "../../model/types.js";
import type { TerminalController } from "./controller.js";

export async function addControllerDrawing(
  controller: TerminalController,
  drawing: Drawing
): Promise<void> {
  const state = controller.getSnapshot(),
    owner = state.owner,
    activeTool = state.activeTool,
    symbol = state.preferences.symbol,
    uid = selectedMarketRow(state.rows, state.preferences)?.uid;
  await controller.setDrawings([...state.drawings, drawing]);
  const current = controller.getSnapshot();
  if (
    owner === current.owner &&
    activeTool === current.activeTool &&
    symbol === current.preferences.symbol &&
    uid === selectedMarketRow(current.rows, current.preferences)?.uid
  )
    controller.update({
      selectedObject: drawing.id,
      activeTool: drawingToolbarSettings(current.preferences.chartSettings).stayInDrawingMode
        ? current.activeTool
        : null,
      preview: null
    });
}
