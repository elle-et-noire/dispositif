"use client";

import React, { useContext, useRef, useEffect } from "react"
import { MathJaxBaseContext, MathJax3Object, MathJax } from "better-react-mathjax"
import { CompileMDXResult } from 'next-mdx-remote/rsc'

type Props = {
  mdx: CompileMDXResult<Record<string, unknown>>;
  mathblocks: string[];
};

const isMathJax3Object = (mjObject: unknown): mjObject is MathJax3Object => {
  return !!(mjObject as MathJax3Object)?.startup
}

export default function PostContentMath(props: Props) {
  const mjContext = useContext(MathJaxBaseContext);
  const mathBlock = useRef(null);
  useEffect(() => {
    if (mjContext && mathBlock.current) {
      mjContext.promise.then((mathJax) => {
        if (isMathJax3Object(mathJax)) {
          mathJax.startup.promise.then(() => {
            mathJax.texReset();
            Array.from(document.querySelectorAll(`.window a[href^="#mjx-eqn%3A"]`)).forEach(elem => {
              elem.classList.add("prevent-dom-operator");
            });
            props.mathblocks.forEach((value, index) => {
              // mathblock に含まれる \label{} を抽出
              const labels = value.match(/\\tag\*\{\\eqref\{[^}]+\}\}/g)?.map(label => label.substring(13, label.length - 2));
              // 各 \label についてリンクにイベントリスナーを加える（対応するリンクがないこともありうる）
              labels?.forEach(label => {
                const mathlinks = Array.from(document.querySelectorAll(`a[href="#mjx-eqn%3A${encodeURIComponent(label)}"]`));
                const modal = document.getElementById(`preview-mjx-${encodeURIComponent(index)}`);
                if (modal != null) {
                  for (const ml of mathlinks) {
                    if (ml.classList.contains("prevent-dom-operator")) continue;
                    ml.classList.add("dom-operated");
                    ml.addEventListener('mouseenter', function () {
                      modal.style.visibility = 'visible';
                      modal.style.opacity = '100';
                      modal.style.transitionDelay = '1s';
                    });
                    ml.addEventListener('mouseleave', function () {
                      modal.style.visibility = '';
                      modal.style.opacity = '';
                      modal.style.transitionDelay = '0s';
                    });
                  }
                }
              });
            });
            document.querySelectorAll<HTMLElement>(`mjx-container[jax="SVG"] > svg a`).forEach(ref => {
              ref.style.fill = '#f0f6fc';
              ref.style.stroke = '#f0f6fc';
            })
          });
        }
      });
    }
  });

  return (
    <div ref={mathBlock} className="post">
      {props.mdx.content}
      <MathJax hideUntilTypeset={"first"}>
        {props.mathblocks.map((value, index) => (
          <div key={index} id={`preview-mjx-${encodeURIComponent(index)}`} className="window">
            {value}
          </div>
        ))}
      </MathJax>
    </div>
  );
}