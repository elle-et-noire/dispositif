import { ThemeToggle } from "./theme-toggle";

const patternSize = 750;
const eyesCount = 40;

// 背景模様の固定シード。これを基に決定論的に目玉の配置を生成するため、
// サーバー・クライアントを問わず、また何度リロードしても常に同じ背景になる。
// （以前は Math.random で毎ロード変化していた。）
const SEED = 0x9e3779b9;

const retroColors = ['#ece5d3', '#90332f', '#8b7a95', '#1f1b1c'];
const retroBg = '#1f1b1c';

const darkColors = ['#007ba7', '#003388', '#001533', '#02050a'];
const darkBg = '#02050a';

// 目玉の型定義
type EyeLayer = { size: number; offsetX: number; offsetY: number; colorIndex: number };
type BaseEye = { x: number; y: number; size: number; baseLayers: EyeLayer[] };

// 決定論的な擬似乱数生成器（mulberry32）。固定シードから常に同じ数列を返す。
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 目玉の配置（設計図）を生成する。テーマには依存しない幾何データのみ。
// 乱数源を引数で受け取るため、固定シードを渡せば結果は決定論的になる。
function generateBaseEyes(rng: () => number): BaseEye[] {
  const baseEyes: BaseEye[] = [];
  const colorUsage = [0, 0, 0, 0];

  function getBalancedColorIndex(usedIndices: number[], currentSize: number) {
    const availableIndices = [0, 1, 2, 3].filter(i => !usedIndices.includes(i));
    let minUsage = Infinity;
    availableIndices.forEach(i => {
      if (colorUsage[i] < minUsage) minUsage = colorUsage[i];
    });
    const candidateIndices = availableIndices.filter(i => colorUsage[i] === minUsage);
    const selectedIndex = candidateIndices[Math.floor(rng() * candidateIndices.length)];
    colorUsage[selectedIndex] += currentSize * currentSize;
    return selectedIndex;
  }

  for (let i = 0; i < eyesCount; i++) {
    const size = rng() * 50 + 200;
    let x = 0, y = 0;
    let positionFound = false;
    let attempts = 0;

    while (!positionFound && attempts < 1000) {
      x = rng() * patternSize;
      y = rng() * patternSize;
      positionFound = true;

      for (const existingEye of baseEyes) {
        let dx = Math.abs(x - existingEye.x);
        let dy = Math.abs(y - existingEye.y);
        if (dx > patternSize / 2) dx = patternSize - dx;
        if (dy > patternSize / 2) dy = patternSize - dy;

        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < (size / 2 + existingEye.size / 2) * 0.5) {
          positionFound = false;
          break;
        }
      }
      attempts++;
    }

    const layersCount = Math.floor(rng() * 1) + 3;
    let currentSize = size;
    let totalOffsetX = 0;
    let totalOffsetY = 0;
    const baseLayers: EyeLayer[] = [];
    const angle = rng() * Math.PI * 2;
    const usedIndices: number[] = [];

    for (let j = 0; j < layersCount; j++) {
      if (j > 0) {
        const prevSize = currentSize;
        currentSize = prevSize * (rng() * 0.05 + 0.65);
        const dist = 0.8 * ((prevSize - currentSize) / 2);
        totalOffsetX += Math.cos(angle) * dist;
        totalOffsetY += Math.sin(angle) * dist;
      }
      const colorIndex = getBalancedColorIndex(usedIndices, currentSize);
      usedIndices.push(colorIndex);
      baseLayers.push({ size: currentSize, offsetX: totalOffsetX, offsetY: totalOffsetY, colorIndex });
    }
    baseEyes.push({ x, y, size, baseLayers });
  }
  return baseEyes;
}

// 目玉の配置データから、指定テーマの配色で背景タイル SVG を組み立て、
// CSS background-image に使える data URL を返す。
function buildBackgroundImage(baseEyes: BaseEye[], colors: string[], bg: string): string {
  let patternContent = '';

  function addEye(baseX: number, baseY: number, layers: EyeLayer[]) {
    let eyeSVG = `<g transform="translate(${baseX}, ${baseY})">`;
    layers.forEach((layer) => {
      const color = colors[layer.colorIndex];
      eyeSVG += `<circle cx="${layer.offsetX}" cy="${layer.offsetY}" r="${layer.size / 2}" fill="${color}" />`;
    });
    eyeSVG += `</g>`;
    patternContent += eyeSVG;
  }

  baseEyes.forEach(eye => {
    const { x, y, size, baseLayers } = eye;
    const r = size / 2;

    addEye(x, y, baseLayers);

    // はみ出しコピー処理（タイルの継ぎ目で目玉が途切れないよう周囲に複製する）
    const crossLeft = x - r < 0;
    const crossRight = x + r > patternSize;
    const crossTop = y - r < 0;
    const crossBottom = y + r > patternSize;

    if (crossLeft) addEye(x + patternSize, y, baseLayers);
    if (crossRight) addEye(x - patternSize, y, baseLayers);
    if (crossTop) addEye(x, y + patternSize, baseLayers);
    if (crossBottom) addEye(x, y - patternSize, baseLayers);
    if (crossLeft && crossTop) addEye(x + patternSize, y + patternSize, baseLayers);
    if (crossLeft && crossBottom) addEye(x + patternSize, y - patternSize, baseLayers);
    if (crossRight && crossTop) addEye(x - patternSize, y + patternSize, baseLayers);
    if (crossRight && crossBottom) addEye(x - patternSize, y - patternSize, baseLayers);
  });

  const svgHTML = `
      <svg width="${patternSize}" height="${patternSize}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${patternSize}" height="${patternSize}" fill="${bg}" />
        ${patternContent}
      </svg>
    `;

  return `url('data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgHTML)}')`;
}

// 固定シードから配置を一度だけ生成し、両テーマの背景画像を組み立てる。
// モジュール評価時（サーバー）に確定するので、SSR の HTML に背景が焼き込まれ、
// 何度リロードしても同じ背景が返る。
const baseEyes = generateBaseEyes(mulberry32(SEED));
const retroImage = buildBackgroundImage(baseEyes, retroColors, retroBg);
const darkImage = buildBackgroundImage(baseEyes, darkColors, darkBg);

export function BackgroundPattern() {
  return (
    <>
      {/* テーマ切り替えボタン（クライアント） */}
      <ThemeToggle />

      {/* 最背面の背景レイヤー。両テーマ分を SSR で出力し、<html> の dark クラスに応じて
          Tailwind の dark: バリアントが display で出し分ける（light を既定表示、dark を
          .dark 配下でのみ表示）。inline script が描画前にクラスを付けるため、ちらつかずに
          正しいテーマで表示される。クラス未付与時（script 失敗）は既定の light が出る。 */}
      <div
        style={{
          backgroundColor: retroBg,
          backgroundImage: retroImage,
          backgroundRepeat: 'repeat',
        }}
        className="fixed inset-0 -z-50 w-full h-full dark:hidden"
      />
      <div
        style={{
          backgroundColor: darkBg,
          backgroundImage: darkImage,
          backgroundRepeat: 'repeat',
        }}
        className="fixed inset-0 -z-50 w-full h-full hidden dark:block"
      />
    </>
  );
}
