import {
  buildCreateDocument, buildGetDocumentInfo, buildResizeDocument, buildCloseDocument,
  buildAddLayer, buildAddFillLayer, buildDeleteLayer, buildSelectLayer, buildSetLayerProperties,
  buildMoveLayer, buildDuplicateLayer, buildReorderLayer, buildGroupLayers, buildGetLayers,
  buildAddText, buildEditText, buildAddShape, buildApplyAdjustment, buildApplyFilter,
  buildTransformLayer, buildAddGradient, buildMakeSelection, buildModifySelection,
  buildFillSelection, buildClearSelection, buildCrop, buildResizeCanvas, buildTrim,
  buildRotateCanvas, buildLayerMask, buildSetClippingMask, buildAddAdjustmentLayer,
  buildMergeLayers, buildSetLayerStyle, buildFitToLayer, buildExportImage, buildRunScript,
  buildUndo, buildRedo, escapeString
} from "./bridge/script-builder.js";
type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
type Tool = { name: string; description: string; inputSchema: Schema; build: (a: Record<string, any>) => { script: string; expectFiles?: boolean; previewMaxSize?: number } };
const str = (description = "") => ({ type: "string", description });
const num = (description = "") => ({ type: "number", description });
const bool = (description = "") => ({ type: "boolean", description });
const en = (values: string[], description = "") => ({ type: "string", enum: values, description });
const obj = (properties: Record<string, unknown>, required: string[] = []): Schema => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });
const target = { anyOf: [{ type: "string" }, { type: "number" }], description: "Layer name or layer index" };
const bounds = { type: "object", properties: { x: num(), y: num(), width: num(), height: num() }, required: ["x","y","width","height"], additionalProperties: false };
const make = (name: string, description: string, properties: Record<string, unknown>, required: string[], build: Tool["build"]): Tool => ({ name, description, inputSchema: obj(properties, required), build });
export const TOOLS: Tool[] = [
 make("photopea_create_document","Create a new document.",{width:num("Width in pixels"),height:num("Height in pixels"),resolution:num("DPI, default 72"),name:str(),mode:en(["RGB","CMYK","Grayscale","Lab","Bitmap"]),fillColor:str("Hex color")},["width","height"],a=>({script:buildCreateDocument(a as any)})),
 make("photopea_get_document_info","Get active document name, dimensions, resolution and color mode.",{},[],()=>({script:buildGetDocumentInfo()})),
 make("photopea_resize_document","Resize document and resample its content.",{width:num(),height:num()},["width","height"],a=>({script:buildResizeDocument(a as any)})),
 make("photopea_close_document","Close the active document.",{save:bool("Save before closing")},["save"],a=>({script:buildCloseDocument(a as any)})),
 make("photopea_crop","Crop to a rectangle in pixels.",{x:num(),y:num(),width:num(),height:num()},["x","y","width","height"],a=>({script:buildCrop(a as any)})),
 make("photopea_resize_canvas","Change canvas size without scaling the artwork.",{width:num(),height:num(),anchor:en(["top-left","top","top-right","left","center","right","bottom-left","bottom","bottom-right"]),fillColor:str("Optional hex fill color")},["width","height","anchor"],a=>({script:buildResizeCanvas(a as any)})),
 make("photopea_trim","Trim transparent or solid-color edges.",{basis:en(["transparent","top-left-color","bottom-right-color"])},["basis"],a=>({script:buildTrim(a.basis as any)})),
 make("photopea_rotate_canvas","Rotate or flip the entire canvas.",{angle:num("Rotation angle in degrees"),flip:en(["horizontal","vertical"])},[],a=>({script:buildRotateCanvas(a as any)})),
 make("photopea_add_layer","Add a blank layer.",{name:str(),opacity:num(),blendMode:str()},[],a=>({script:buildAddLayer(a as any)})),
 make("photopea_add_fill_layer","Add a solid fill layer.",{type:en(["solid"]),color:str("Hex color"),name:str()},["type"],a=>({script:buildAddFillLayer(a as any)})),
 make("photopea_delete_layer","Delete a layer by name or index.",{target},["target"],a=>({script:buildDeleteLayer(a as any)})),
 make("photopea_select_layer","Select a layer by name or index.",{target},["target"],a=>({script:buildSelectLayer(a as any)})),
 make("photopea_set_layer_properties","Set layer opacity, blend mode, visibility, name or lock state.",{target,opacity:num(),blendMode:str(),visible:bool(),name:str(),locked:bool()},["target"],a=>({script:buildSetLayerProperties(a as any)})),
 make("photopea_move_layer","Move a layer by x/y pixels.",{target,x:num(),y:num()},["target","x","y"],a=>({script:buildMoveLayer(a as any)})),
 make("photopea_duplicate_layer","Duplicate a layer.",{target,newName:str()},["target"],a=>({script:buildDuplicateLayer(a as any)})),
 make("photopea_reorder_layer","Reorder a layer in the layer stack.",{target,position:en(["above","below","top","bottom"])},["target","position"],a=>({script:buildReorderLayer(a as any)})),
 make("photopea_group_layers","Group layers by their names.",{layers:{type:"array",items:str()},groupName:str()},["layers"],a=>({script:buildGroupLayers(a as any)})),
 make("photopea_get_layers","Return the active document layer tree as JSON.",{},[],()=>({script:buildGetLayers()})),
 make("photopea_layer_mask","Add or delete a layer mask.",{action:en(["reveal_all","hide_all","from_selection","delete"]),target},["action"],a=>({script:buildLayerMask(a as any)})),
 make("photopea_set_clipping_mask","Enable or disable clipping mask for a layer.",{target,enabled:bool()},["target","enabled"],a=>({script:buildSetClippingMask(a as any)})),
 make("photopea_add_adjustment_layer","Add a non-destructive adjustment layer.",{type:en(["brightness","hue_sat","levels"]),brightness:num(),contrast:num(),hue:num(),saturation:num(),lightness:num(),inputMin:num(),inputMax:num(),gamma:num()},["type"],a=>({script:buildAddAdjustmentLayer(a as any)})),
 make("photopea_merge_layers","Merge down or flatten the document.",{mode:en(["down","flatten"])},["mode"],a=>({script:buildMergeLayers(a.mode as any)})),
 make("photopea_set_layer_style","Apply drop shadow, outer glow and/or stroke.",{target,dropShadow:{type:"object",properties:{color:str(),opacity:num(),angle:num(),distance:num(),size:num()}},outerGlow:{type:"object",properties:{color:str(),opacity:num(),size:num()}},stroke:{type:"object",properties:{color:str(),size:num(),position:en(["outside","inside","center"]),opacity:num()}}},[],a=>({script:buildSetLayerStyle(a as any)})),
 make("photopea_add_text","Add a text layer.",{content:str(),x:num(),y:num(),font:str(),size:num(),color:str(),alignment:en(["left","center","right"]),bold:bool(),italic:bool(),letterSpacing:num(),lineHeight:num(),paragraphBounds:{type:"object",properties:{width:num(),height:num()}}},["content","x","y"],a=>({script:buildAddText(a as any)})),
 make("photopea_edit_text","Edit an existing text layer.",{target,content:str(),font:str(),size:num(),color:str(),alignment:en(["left","center","right"]),letterSpacing:num(),lineHeight:num()},["target"],a=>({script:buildEditText(a as any)})),
 make("photopea_add_shape","Add rectangle or ellipse shape.",{type:en(["rectangle","ellipse"]),bounds,fillColor:str(),strokeColor:str(),strokeWidth:num(),name:str()},["type","bounds"],a=>({script:buildAddShape(a as any)})),
 make("photopea_apply_adjustment","Apply a pixel adjustment such as brightness/contrast, hue/saturation, levels or curves.",{type:str(),settings:{type:"object",additionalProperties:{anyOf:[{type:"number"},{type:"string"},{type:"boolean"}]}}},["type"],a=>({script:buildApplyAdjustment(a as any)})),
 make("photopea_apply_filter","Apply a filter such as gaussian blur, sharpen, unsharp mask, noise or motion blur.",{type:str(),settings:{type:"object",additionalProperties:{anyOf:[{type:"number"},{type:"string"},{type:"boolean"}]}}},["type"],a=>({script:buildApplyFilter(a as any)})),
 make("photopea_transform_layer","Scale, rotate or flip a layer.",{target,scaleX:num(),scaleY:num(),rotation:num(),flipH:bool(),flipV:bool()},["target"],a=>({script:buildTransformLayer(a as any)})),
 make("photopea_add_gradient","Apply a linear gradient to a layer.",{target,type:en(["linear"]),colors:{type:"array",items:str()},angle:num()},["target","type","colors"],a=>({script:buildAddGradient(a as any)})),
 make("photopea_make_selection","Create a rectangular, elliptical or full selection.",{type:en(["all","rect","ellipse"]),bounds,feather:num()},["type"],a=>({script:buildMakeSelection(a as any)})),
 make("photopea_modify_selection","Expand, contract, feather or invert the selection.",{action:en(["expand","contract","feather","invert"]),amount:num()},["action"],a=>({script:buildModifySelection(a as any)})),
 make("photopea_fill_selection","Fill current selection with a color.",{color:str("Hex color"),opacity:num(),blendMode:str()},["color"],a=>({script:buildFillSelection(a as any)})),
 make("photopea_clear_selection","Deselect the current selection.",{},[],()=>({script:buildClearSelection()})),
 make("photopea_get_preview","Export a downscaled PNG preview of the active document.",{maxSize:{type:"integer",minimum:128,maximum:3000}},[],a=>({script:"app.activeDocument.saveToOE('png');",expectFiles:true,previewMaxSize:Math.max(128,Math.min(3000,Number(a.maxSize||1200)))})),
 make("photopea_export_image","Export active document as PNG, JPG, WebP, PSD or SVG. Returns base64 file data in the tool result.",{format:en(["png","jpg","webp","psd","svg"]),quality:num()},["format"],a=>({script:buildExportImage({...a,outputPath:""} as any),expectFiles:true})),
 make("photopea_run_script","Run arbitrary Photopea JavaScript. Use app.echoToOE(value) to return text results.",{script:str()},["script"],a=>({script:buildRunScript(String(a.script||""))})),
 make("photopea_undo","Undo one or more operations.",{steps:{type:"integer",minimum:1,maximum:100}},[],a=>({script:buildUndo(Number(a.steps||1))})),
 make("photopea_redo","Redo one or more operations.",{steps:{type:"integer",minimum:1,maximum:100}},[],a=>({script:buildRedo(Number(a.steps||1))})),
 make("photopea_ungroup_layers","Dissolve a named layer group and move its children to the document root.",{target:str("Layer group name")},["target"],a=>({script:"var _d=app.activeDocument;var _g=_d.layerSets.getByName('"+escapeString(String(a.target||""))+"');while(_g.layers.length>0){_g.layers[0].move(_d.layers[_d.layers.length-1],ElementPlacement.PLACEBEFORE);}_g.remove();app.echoToOE('ok');"})),
 make("photopea_load_font","Load a public TTF or OTF font URL into Photopea. WOFF2 is not supported.",{url:str("Public HTTPS font URL")},["url"],a=>({script:"var _doc=app.activeDocument?app.activeDocument.name:null;app.open('"+escapeString(String(a.url||""))+"');if(_doc){app.activeDocument=app.documents.getByName(_doc);}app.echoToOE('Font loaded.');"})),
 make("photopea_list_fonts","List Photopea font PostScript names, optionally filtered by a search term.",{search:str()},[],a=>({script:a.search?"var r=[];for(var i=0;i<app.fonts.length;i++){var n=app.fonts[i].postScriptName;if(n.toLowerCase().indexOf('"+escapeString(String(a.search).toLowerCase())+"')>=0)r.push(n);}app.echoToOE(JSON.stringify(r));":"var r=[];for(var i=0;i<app.fonts.length;i++){r.push(app.fonts[i].postScriptName);}app.echoToOE(JSON.stringify(r));"}))

];
export function getTool(name: string) { return TOOLS.find(t => t.name === name); }
