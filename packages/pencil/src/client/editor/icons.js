// Lucide icons for tools and layer types, as OpenPencil's app maps them (src/components/icons).
import { MousePointer2, Frame, SquareDashed, Square, Circle, Minus, Triangle, Star, PenTool, Pencil, Type, Hand, Group, Component, Image, Spline, Pipette, StickyNote, Shapes, MessageCircle } from 'lucide-vue-next';

export const toolIcons = {
  SELECT: MousePointer2, FRAME: Frame, SECTION: SquareDashed, RECTANGLE: Square, ELLIPSE: Circle, LINE: Minus,
  POLYGON: Triangle, STAR: Star, PEN: PenTool, PENCIL: Pencil, TEXT: Type, HAND: Hand, EYEDROPPER: Pipette,
  STICKY: StickyNote, SHAPE_WITH_TEXT: Shapes, CONNECTOR: Spline, COMMENT: MessageCircle,
};
const nodeIcons = {
  SECTION: SquareDashed, ELLIPSE: Circle, FRAME: Frame, GROUP: Group, COMPONENT: Component, COMPONENT_SET: Component,
  INSTANCE: Component, LINE: Minus, TEXT: Type, VECTOR: PenTool, RECTANGLE: Square, ROUNDED_RECTANGLE: Square,
  STAR: Star, POLYGON: Triangle, BOOLEAN_OPERATION: Shapes, CONNECTOR: Spline,
};
export const nodeIcon = (node) => (node.type === 'RECTANGLE' && node.fills?.some?.((f) => f.type === 'IMAGE') ? Image : nodeIcons[node.type] ?? Square);
export const isComponentType = (type) => type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'INSTANCE';
