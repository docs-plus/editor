export { FindController, type FindSnapshot } from "./find-controller";
export {
  type FindHit,
  MAX_FIND_HITS,
  scanHits,
  updateHits,
} from "./find-hits";
export {
  FIND_CURRENT_HIGHLIGHT,
  FIND_HIGHLIGHT,
  type FindPainter,
  type HighlightApi,
  HighlightPainter,
  SelectionPainter,
  supportsHighlights,
} from "./find-painter";
export { buildFindPattern, type FindOptions } from "./find-pattern";
