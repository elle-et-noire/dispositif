import assert from "node:assert/strict";
import test from "node:test";
import { SCALE, ticks, fromCss, toCss, zero, createLayout, articleColumns, horizontalRange, verticalRange,
  horizontalInputRange, horizontalDestination, verticalDestination, paperWindow, slotColumns, nearestPoint,
  ReadingState } from "../src/scripts/reading-coordinates.ts";
import { nativeWindow, cssGeometry } from "../src/scripts/reading-geometry.ts";
import { ReadingViewport } from "../src/scripts/reading-viewport.ts";

const layout = (width = 1600, length = 70000, overlap = 21) => createLayout(Math.min(608, width - 32), 16, 700, overlap, length, width, 16);
const close = (a: number, b: number, tolerance = .001) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test("内部座標は整数で、微小な負の値も同じ0に正規化する", () => {
  for (const value of [-1e-5, 0, 1e-5]) assert.equal(Object.is(fromCss(value), 0), true);
  for (const value of [-1234.4567, 1 / 3, 1e8]) {
    assert.ok(Number.isSafeInteger(fromCss(value)));
    close(toCss(fromCss(value)), value, 1 / SCALE);
  }
});

test("HomeとEndは対称な本文端で、そこから外側へ横移動できない", () => {
  for (const width of [390, 1280, 1600]) for (const overlap of [0, 21, 175]) {
    const g = layout(width, 70003, overlap), state = new ReadingState(g);
    state.home(); const home = state.point;
    state.horizontal(ticks(-100 * g.p)); assert.deepEqual(state.point, home);
    state.end(); const end = state.point;
    state.horizontal(ticks(end.x + 100 * g.p)); assert.deepEqual(state.point, end);
    const k = Math.floor((g.l - g.h) / g.step);
    assert.equal(k * g.p + g.w + 2 * g.edge - end.x, g.viewportWidth);
    assert.equal(k * g.step + end.y + g.h, g.l);
    state.home(); assert.deepEqual(state.point, { x: zero, y: zero });
  }
});

test("1段分の余白は縦方向でだけ作れ、横位置を動かさず内側へ戻れる", () => {
  const g = layout();
  for (const direction of [-1, 1]) {
    const state = new ReadingState(g);
    if (direction > 0) state.end(); else state.home();
    const start = state.point;
    const vertical = verticalRange(start.x, g);
    state.vertical(direction < 0 ? vertical.min : vertical.max);
    const fringe = state.point;
    assert.equal(fringe.x, start.x);
    const normal = horizontalRange(fringe.y, g);
    assert.equal(direction < 0 ? normal.min - fringe.x : fringe.x - normal.max, g.p);
    const partial = direction < 0 ? 0 : Math.floor((g.l - g.h) / g.step);
    assert.equal(paperWindow(ticks(partial * g.step + fringe.y), g).height, 0);
    state.horizontal(ticks(fringe.x + direction * g.p));
    assert.deepEqual(state.point, fringe, "外側の余白を増やす方向に動けた");
    state.horizontal(ticks(fringe.x - direction * fromCss(13)));
    assert.equal(state.point.y, fringe.y);
    assert.equal(state.point.x, fringe.x - direction * fromCss(13));
    const midway = state.point;
    state.horizontal(ticks(midway.x + direction * 1)); assert.deepEqual(state.point, midway);
    state.horizontal(direction < 0 ? normal.min : normal.max);
    assert.equal(state.point.y, fringe.y);
    assert.equal(state.point.x, direction < 0 ? normal.min : normal.max);
  }
});

test("一軸だけの操作は他軸の座標を1単位も変えない", () => {
  const g = layout();
  for (const y of [zero, ticks(g.step - 1), ticks(3 * g.step + 71)]) {
    const point = { x: ticks(2 * g.p + 19), y };
    for (const target of [ticks(-1e10), zero, ticks(1e10)]) {
      assert.equal(horizontalDestination(point, target, g).y, point.y);
      assert.equal(verticalDestination(point, target, g).x, point.x);
    }
  }
});

test("同じ位置と操作の結果は到達経路によらず一致する", () => {
  const g = layout();
  const a = new ReadingState(g), b = new ReadingState(g);
  a.vertical(fromCss(4000)); a.horizontal(fromCss(600)); a.vertical(fromCss(200));
  b.horizontal(fromCss(600)); b.vertical(fromCss(200));
  assert.deepEqual(a.point, b.point);
  for (const state of [a,b]) { state.horizontal(fromCss(900)); state.vertical(fromCss(-200)); }
  assert.deepEqual(a.point, b.point);
  a.end(); b.home(); b.end(); assert.deepEqual(a.point, b.point);
});

test("重なりを縮めても本文全体を覆い、末尾側の上端と先頭側の下端がずれない", () => {
  for (const overlap of [0,21,175]) for (const length of [701,900,13573]) {
    const g = layout(1600, length, overlap);
    for (const y of [-1291,-100,0,173,3549].map(fromCss)) {
      const columns = articleColumns(y, g); let end = 0;
      for (let k=columns.first; k<=columns.last; k++) {
        const from = ticks(k*g.step+y), paper = paperWindow(from,g);
        assert.ok(from+paper.top-paper.shift <= end);
        end = Math.max(end, from+paper.top+paper.height-paper.shift);
        if (from >= 0) assert.equal(paper.top, 0);
        if (from < 0 && paper.height > 0) assert.equal(paper.top+paper.height,g.h);
      }
      assert.equal(end,g.l);
    }
    assert.equal(paperWindow(ticks(-g.step), g).height,0);
    assert.equal(paperWindow(ticks(g.l-g.h+g.step),g).height,0);
  }
});

test("短い記事は1段だけで、白い面も本文の高さになる", () => {
  for (const width of [390,1600]) for (const length of [1,200,700]) {
    const g=layout(width,length), state=new ReadingState(g);
    state.horizontal(fromCss(1e8)); state.vertical(fromCss(1e8)); state.end();
    assert.deepEqual(state.point,{x:zero,y:zero});
    assert.equal(slotColumns(state.point,g).count,1);
    assert.equal(paperWindow(zero,g).height,g.l);
  }
});

test("長い記事でもネイティブ平面と表示枠の数を制限し、組み替えで座標を変えない", () => {
  const g=layout(1600,1e8);
  let previous;
  for (const anchor of [0,42000,1e6,8e7].map(fromCss)) {
    const state=new ReadingState(g,anchor), point=state.point;
    const window=nativeWindow(point,g,previous); previous=window;
    assert.ok(window.x.span <= 128*g.p); assert.ok(window.y.span <=127*g.h);
    const actualX=toCss(point.x-window.x.origin)+.23, actualY=toCss(point.y-window.y.origin)-.19;
    const css=cssGeometry(g,point,window,actualX,actualY,1);
    close(actualX+css.originColumn*css.p-css.leading,toCss(point.x));
    close(actualY+css.originY,toCss(point.y));
    const slots=slotColumns(point,g);
    assert.equal(slots.count,Math.ceil(g.viewportWidth/g.p)+1);
    for(let k=slots.start-2;k<slots.start+slots.count+2;k++) {
      const left=g.edge+k*g.p-point.x;
      if(left<g.viewportWidth&&left+g.w>0)assert.ok(k>=slots.start&&k<slots.start+slots.count);
    }
    assert.deepEqual(state.point,point);
  }
});

test("ハッシュ移動は対象を含む窓へ移動し、結果を整数座標で保持する", () => {
  const g=layout(1600,2e6), state=new ReadingState(g);
  for(const target of [0,701,20000,1000000,g.l/SCALE-1].map(fromCss)) {
    const point=nearestPoint(target,state.point,g), columns=slotColumns(point,g);
    let visible=false;
    for(let k=columns.start;k<columns.start+columns.count;k++) {
      const left=g.edge+k*g.p-point.x, y=target-k*g.step-point.y;
      if(left>=0&&left+g.w<=g.viewportWidth&&y>=0&&y<g.h)visible=true;
    }
    assert.ok(visible); assert.ok(Number.isInteger(point.x)&&Number.isInteger(point.y));
  }
});

class BrowserPort {
  style={width:"",height:""}; dataset: Record<string,string>={};
  clientWidth=1600; clientHeight=700; unit: number;
  private x=0; private y=0;
  constructor(unit:number){this.unit=unit;}
  span(axis:"width"|"height"){return Number(this.style[axis].match(/\+ ([\d.]+)px/)?.[1]??0);}
  get scrollWidth(){return Math.round(this.clientWidth+this.span("width"));}
  get scrollHeight(){return Math.round(this.clientHeight+this.span("height"));}
  get scrollLeft(){return this.x;}
  set scrollLeft(value:number){this.x=Math.max(0,Math.min(Math.floor(this.span("width")/this.unit)*this.unit,Math.round(value/this.unit)*this.unit));}
  get scrollTop(){return this.y;}
  set scrollTop(value:number){this.y=Math.max(0,Math.min(Math.floor(this.span("height")/this.unit)*this.unit,Math.round(value/this.unit)*this.unit));}
  scrollTo(point:{left:number;top:number}){this.scrollLeft=point.left;this.scrollTop=point.top;}
}

test("Home/Endの書き込みを読み戻しても丸め誤差で論理位置や移動範囲を変えない", () => {
  const g=layout();
  for(const unit of [1, .909090936, .8888889, .8, 2/3]) {
    const port=new BrowserPort(unit), state=new ReadingState(g);
    const adapter=new ReadingViewport(port as unknown as HTMLElement, port as unknown as HTMLElement,unit);
    for(let i=0;i<20;i++)for(const end of [false,true]) {
      if(end)state.end();else state.home();
      const expected=state.point;
      adapter.place(state.point,g,true);
      assert.equal(adapter.read(state.point),undefined);
      assert.deepEqual(state.point,expected);
      const range=horizontalInputRange(state.point,g);
      state.horizontal(ticks(state.point.x+(end?1:-1)*g.p));
      assert.deepEqual(state.point,expected);
      assert.equal(end?range.max:range.min,expected.x);
    }
  }
});

test("ネイティブ入力の端をアダプターでだけ正規化し、末尾に白い線を残さない", () => {
  const g=layout();
  for(const unit of [.909090936,.8888889,.8,2/3]) {
    const port=new BrowserPort(unit), state=new ReadingState(g);
    const adapter=new ReadingViewport(port as unknown as HTMLElement,port as unknown as HTMLElement,unit);
    state.end();adapter.place(state.point,g,true);
    const x=state.point.x, limit=verticalRange(x,g).max;
    port.scrollTop=1e9;
    const movement=adapter.read(state.point);
    assert.ok(movement?.y!==undefined);
    state.vertical(movement!.y!);adapter.place(state.point,g);
    assert.equal(state.point.x,x);assert.equal(state.point.y,limit);
    const k=Math.floor((g.l-g.h-limit)/g.step);
    assert.equal(paperWindow(ticks((k+1)*g.step+limit),g).height,0);
  }
});

test("小数のネイティブ移動でも投影原点は揺れず、往復で量子化誤差が蓄積しない", () => {
  const g = layout();
  for (const unit of [1, .909090936, .8888889, .8, 2/3]) {
    const port = new BrowserPort(unit), state = new ReadingState(g, fromCss(400));
    state.horizontal(fromCss(123.4567));
    const adapter = new ReadingViewport(port as unknown as HTMLElement, port as unknown as HTMLElement, unit);
    const initial = adapter.place(state.point, g, true), origin = state.point.x, nativeStart = port.scrollLeft;
    for (let i = 0; i < 200; i++) {
      port.scrollLeft = nativeStart + (i % 2 ? -30 : 90) * unit;
      const movement = adapter.read(state.point);
      assert.ok(movement?.x !== undefined);
      state.horizontal(movement.x);
      const view = adapter.place(state.point, g);
      assert.equal(view.leading, initial.leading);
      assert.equal(view.originY, initial.originY);
      assert.equal(state.point.x, origin + fromCss(port.scrollLeft) - fromCss(nativeStart));
    }
    port.scrollLeft = nativeStart;
    state.horizontal(adapter.read(state.point)!.x!);
    assert.equal(state.point.x, origin);
  }
});
