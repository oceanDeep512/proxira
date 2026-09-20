import { useEffect, useState } from "react";

/**
 * 每隔 `intervalMs` 滴答一次的当前时间戳。
 *
 * 用途：详情面板里的「3 分钟前」是相对时间，渲染一次就定死了 ——
 * 盯着面板看两分钟，它还会说「刚刚」。SSE 只在有新请求时推事件，
 * 没有新请求时组件不会重渲染，所以必须自带一个节拍器。
 *
 * 默认 15s：相对时间的精度是分钟级，秒级刷新纯属浪费；
 * 15s 的误差对「N 分钟前」这种粗粒度展示完全无感。
 */
export const useNow = (intervalMs = 15_000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
};
