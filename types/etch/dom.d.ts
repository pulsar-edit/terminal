import type {
  JSX,
  EtchJSXElement,
  EtchExtraProps,
  Props,
  ChildSpec,
  ElementClassConstructor
} from "./etch-element";

interface DomFunction<T extends keyof HTMLElementTagNameMap> {
  (
    props: Partial<HTMLElementTagNameMap[T]> & EtchExtraProps & Props,
    ...children: ChildSpec[]
  ): EtchJSXElement;
  (...children: ChildSpec[]): EtchJSXElement;
}

interface DomSvgFunction<T extends keyof SVGElementTagNameMap> {
  (
    props: SVGElementTagNameMap[T] & EtchExtraProps & Props,
    ...children: ChildSpec[]
  ): EtchJSXElement;
  (...children: ChildSpec[]): EtchJSXElement;
}

interface SvgTagFunctions {
  circle: DomSvgFunction<'circle'>;
  clipPath: DomSvgFunction<'clipPath'>;
  defs: DomSvgFunction<'defs'>;
  ellipse: DomSvgFunction<'ellipse'>;
  g: DomSvgFunction<'g'>;
  image: DomSvgFunction<'image'>;
  line: DomSvgFunction<'line'>;
  linearGradient: DomSvgFunction<'linearGradient'>;
  mask: DomSvgFunction<'mask'>;
  path: DomSvgFunction<'path'>;
  pattern: DomSvgFunction<'pattern'>;
  polygon: DomSvgFunction<'polygon'>;
  polyline: DomSvgFunction<'polyline'>;
  radialGradient: DomSvgFunction<'radialGradient'>;
  rect: DomSvgFunction<'rect'>;
  stop: DomSvgFunction<'stop'>;
  svg: DomSvgFunction<'svg'>;
  text: DomSvgFunction<'text'>;
  tspan: DomSvgFunction<'tspan'>;
}

interface DomTagFunctions {
  a: DomFunction<'a'>;
  abbr: DomFunction<'abbr'>;
  address: DomFunction<'address'>;
  article: DomFunction<'article'>;
  aside: DomFunction<'aside'>;
  audio: DomFunction<'audio'>;
  b: DomFunction<'b'>;
  bdi: DomFunction<'bdi'>;
  bdo: DomFunction<'bdo'>;
  blockquote: DomFunction<'blockquote'>;
  body: DomFunction<'body'>;
  button: DomFunction<'button'>;
  canvas: DomFunction<'canvas'>;
  caption: DomFunction<'caption'>;
  cite: DomFunction<'cite'>;
  code: DomFunction<'code'>;
  colgroup: DomFunction<'colgroup'>;
  datalist: DomFunction<'datalist'>;
  dd: DomFunction<'dd'>;
  del: DomFunction<'del'>;
  details: DomFunction<'details'>;
  dfn: DomFunction<'dfn'>;
  dialog: DomFunction<'dialog'>;
  div: DomFunction<'div'>;
  dl: DomFunction<'dl'>;
  dt: DomFunction<'dt'>;
  em: DomFunction<'em'>;
  fieldset: DomFunction<'fieldset'>;
  figcaption: DomFunction<'figcaption'>;
  figure: DomFunction<'figure'>;
  footer: DomFunction<'footer'>;
  form: DomFunction<'form'>;
  h1: DomFunction<'h1'>;
  h2: DomFunction<'h2'>;
  h3: DomFunction<'h3'>;
  h4: DomFunction<'h4'>;
  h5: DomFunction<'h5'>;
  h6: DomFunction<'h6'>;
  head: DomFunction<'head'>;
  header: DomFunction<'header'>;
  html: DomFunction<'html'>;
  i: DomFunction<'i'>;
  iframe: DomFunction<'iframe'>;
  ins: DomFunction<'ins'>;
  kbd: DomFunction<'kbd'>;
  label: DomFunction<'label'>;
  legend: DomFunction<'legend'>;
  li: DomFunction<'li'>;
  main: DomFunction<'main'>;
  map: DomFunction<'map'>;
  mark: DomFunction<'mark'>;
  menu: DomFunction<'menu'>;
  meter: DomFunction<'meter'>;
  nav: DomFunction<'nav'>;
  noscript: DomFunction<'noscript'>;
  object: DomFunction<'obj'>;
  ol: DomFunction<'ol'>;
  optgroup: DomFunction<'optgroup'>;
  option: DomFunction<'option'>;
  output: DomFunction<'output'>;
  p: DomFunction<'p'>;
  pre: DomFunction<'pre'>;
  progress: DomFunction<'progress'>;
  q: DomFunction<'q'>;
  rp: DomFunction<'rp'>;
  rt: DomFunction<'rt'>;
  ruby: DomFunction<'ruby'>;
  s: DomFunction<'s'>;
  samp: DomFunction<'samp'>;
  script: DomFunction<'script'>;
  section: DomFunction<'section'>;
  select: DomFunction<'select'>;
  small: DomFunction<'small'>;
  span: DomFunction<'span'>;
  strong: DomFunction<'strong'>;
  style: DomFunction<'style'>;
  sub: DomFunction<'sub'>;
  summary: DomFunction<'summary'>;
  sup: DomFunction<'sup'>;
  table: DomFunction<'table'>;
  tbody: DomFunction<'tbody'>;
  td: DomFunction<'td'>;
  textarea: DomFunction<'textarea'>;
  tfoot: DomFunction<'tfoot'>;
  th: DomFunction<'th'>;
  thead: DomFunction<'thead'>;
  time: DomFunction<'time'>;
  title: DomFunction<'title'>;
  tr: DomFunction<'tr'>;
  u: DomFunction<'u'>;
  ul: DomFunction<'ul'>;
  var: DomFunction<'var'>;
  video: DomFunction<'video'>;
  area: DomFunction<'area'>;
  base: DomFunction<'base'>;
  br: DomFunction<'br'>;
  col: DomFunction<'col'>;
  command: DomFunction<'command'>;
  embed: DomFunction<'embed'>;
  hr: DomFunction<'hr'>;
  img: DomFunction<'img'>;
  input: DomFunction<'input'>;
  keygen: DomFunction<'keygen'>;
  link: DomFunction<'link'>;
  meta: DomFunction<'meta'>;
  param: DomFunction<'param'>;
  source: DomFunction<'source'>;
  track: DomFunction<'track'>;
  wbr: DomFunction<'wbr'>;
}

type Constructor<T = any> = new (...args: any[]) => T;

export const dom: {
  <T extends keyof HTMLElementTagNameMap>(
    tag: T,
    props?: HTMLElementTagNameMap[T] & EtchExtraProps & Props,
    ...children: ChildSpec[]
  ): EtchJSXElement;

  <T extends keyof SVGElementTagNameMap>(
    tag: T,
    props?: SVGElementTagNameMap[T] & EtchExtraProps & Props,
    ...children: ChildSpec[]
  ): EtchJSXElement;

  // Loophole that lets us pass any initial object that can be instantiated.
  // This corresponds to custom etch components. Pass the object instance type
  // as the first generic argument and the props type as the second, or else
  // omit both.
  <T extends unknown, P extends unknown>(
    tag: Constructor<T>,
    props: P,
    ...children: ChildSpec[]
  ): EtchJSXElement;

  // Catch-all for custom elements that aren't covered by the above. This is
  // a bit sloppy, but lets someone use those elements without adding them to
  // `HTMLElementTagNameMap` first.
  (
    tag: string,
    props?: EtchExtraProps & Props,
    ...children: ChildSpec[]
  ): EtchJSXElement;
} & DomTagFunctions & SvgTagFunctions;
