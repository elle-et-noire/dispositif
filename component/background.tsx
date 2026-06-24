"use client";

import { useEffect, useState, useRef } from "react";

const patternSize = 750;
const eyesCount = 40;

// 模様（目玉の配置）とテーマをセッション内で保持するためのキー。
// 記事を開閉するとページ全体がリロードされるため、これが無いと毎回
// 模様が再計算されて変わってしまう。sessionStorage なのでタブを開いている
// 間は同じ模様・テーマが保たれ、新しい訪問では新しい模様になる。
const EYES_STORAGE_KEY = 'bg-pattern-eyes-v1';
const THEME_STORAGE_KEY = 'bg-pattern-dark-v1';

const retroColors = ['#ece5d3', '#90332f', '#8b7a95', '#1f1b1c'];
const retroBg = '#1f1b1c';

const darkColors = ['#007ba7', '#003388', '#001533', '#02050a'];
const darkBg = '#02050a';

// 目玉の型定義
type EyeLayer = { size: number; offsetX: number; offsetY: number; colorIndex: number };
type BaseEye = { x: number; y: number; size: number; baseLayers: EyeLayer[] };

// 目玉の配置（設計図）をランダム生成する。テーマには依存しない幾何データのみ。
function generateBaseEyes(): BaseEye[] {
  const baseEyes: BaseEye[] = [];
  const colorUsage = [0, 0, 0, 0];

  function getBalancedColorIndex(usedIndices: number[], currentSize: number) {
    const availableIndices = [0, 1, 2, 3].filter(i => !usedIndices.includes(i));
    let minUsage = Infinity;
    availableIndices.forEach(i => {
      if (colorUsage[i] < minUsage) minUsage = colorUsage[i];
    });
    const candidateIndices = availableIndices.filter(i => colorUsage[i] === minUsage);
    const selectedIndex = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
    colorUsage[selectedIndex] += currentSize * currentSize;
    return selectedIndex;
  }

  for (let i = 0; i < eyesCount; i++) {
    const size = Math.random() * 50 + 200;
    let x = 0, y = 0;
    let positionFound = false;
    let attempts = 0;

    while (!positionFound && attempts < 1000) {
      x = Math.random() * patternSize;
      y = Math.random() * patternSize;
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

    const layersCount = Math.floor(Math.random() * 1) + 3;
    let currentSize = size;
    let totalOffsetX = 0;
    let totalOffsetY = 0;
    const baseLayers: EyeLayer[] = [];
    const angle = Math.random() * Math.PI * 2;
    const usedIndices: number[] = [];

    for (let j = 0; j < layersCount; j++) {
      if (j > 0) {
        const prevSize = currentSize;
        currentSize = prevSize * (Math.random() * 0.05 + 0.65);
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

export function BackgroundPattern() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [bgStyle, setBgStyle] = useState({ backgroundColor: retroBg, backgroundImage: '' });

  // 目玉の配置データ（再レンダリングされても値を保持する）
  const baseEyesRef = useRef<BaseEye[]>([]);
  // クライアントでマウントされたかどうか
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    // テーマをセッションから復元（記事を閉じる＝リロードを跨いでも維持する）
    try {
      const savedTheme = sessionStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme !== null) setIsDarkMode(savedTheme === '1');
    } catch { /* sessionStorage 不可（プライベートモード等）の場合は既定値のまま */ }

    // 目玉の配置（設計図）を用意する。
    // セッションに保存済みならそれを再利用し、無ければ生成して保存する。
    // これにより記事を開閉してページがリロードされても模様が変わらない。
    if (baseEyesRef.current.length === 0) {
      let restored: BaseEye[] | null = null;
      try {
        const saved = sessionStorage.getItem(EYES_STORAGE_KEY);
        if (saved) restored = JSON.parse(saved) as BaseEye[];
      } catch { /* 破損データ等は無視して再生成する */ }

      if (restored && restored.length > 0) {
        baseEyesRef.current = restored;
      } else {
        const baseEyes = generateBaseEyes();
        baseEyesRef.current = baseEyes;
        try {
          sessionStorage.setItem(EYES_STORAGE_KEY, JSON.stringify(baseEyes));
        } catch { /* 保存できなくても描画自体は続行する */ }
      }
    }
  }, []);

  // 2. テーマや配置データが変わるたびにSVGを再生成
  useEffect(() => {
    if (!isMounted || baseEyesRef.current.length === 0) return;

    const activeColors = isDarkMode ? darkColors : retroColors;
    const activeBg = isDarkMode ? darkBg : retroBg;
    let patternContent = '';

    function addEye(baseX: number, baseY: number, layers: EyeLayer[]) {
      let eyeSVG = `<g transform="translate(${baseX}, ${baseY})">`;
      layers.forEach((layer) => {
        const color = activeColors[layer.colorIndex];
        eyeSVG += `<circle cx="${layer.offsetX}" cy="${layer.offsetY}" r="${layer.size / 2}" fill="${color}" />`;
      });
      eyeSVG += `</g>`;
      patternContent += eyeSVG;
    }

    baseEyesRef.current.forEach(eye => {
      const { x, y, size, baseLayers } = eye;
      const r = size / 2;

      addEye(x, y, baseLayers);

      // はみ出しコピー処理
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
        <rect width="${patternSize}" height="${patternSize}" fill="${activeBg}" />
        ${patternContent}
      </svg>
    `;

    setBgStyle({
      backgroundColor: activeBg,
      backgroundImage: `url('data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgHTML)}')`
    });

    // ページ本体（page.tsx / [slug]/page.tsx など）も追従させるため、
    // <html> に dark / light クラスをトグルする。Tailwind の dark: variant と
    // globals.css の html.dark / html.light ルールがこれに反応する。
    const root = document.documentElement;
    root.classList.toggle('dark', isDarkMode);
    root.classList.toggle('light', !isDarkMode);

  }, [isDarkMode, isMounted]);

  // SSR時は何も描画しない（チラつき防止）
  if (!isMounted) return null;

  return (
    <>
      {/* テーマ切り替えボタン */}
      <button
        onClick={() => setIsDarkMode((prev) => {
          const next = !prev;
          try { sessionStorage.setItem(THEME_STORAGE_KEY, next ? '1' : '0'); } catch { /* 保存不可でもトグルは行う */ }
          return next;
        })}
        aria-label={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
        className="fixed top-5 left-5 z-50 flex items-center justify-center size-11 text-xl leading-none bg-white/90 text-gray-900 rounded-full shadow-md backdrop-blur-md transition-all hover:-translate-y-0.5 hover:shadow-lg dark:bg-slate-900/90 dark:text-cyan-400 dark:shadow-cyan-400/20"
      >
        {isDarkMode ? '☀️' : '🌙'}
      </button>

      {/* 最背面の背景レイヤー */}
      <div
        style={{
          backgroundColor: bgStyle.backgroundColor,
          backgroundImage: bgStyle.backgroundImage,
          backgroundRepeat: 'repeat',
          transition: 'background-color 0.5s ease',
        }}
        className="fixed inset-0 -z-50 w-full h-full"
      />
    </>
  );
}