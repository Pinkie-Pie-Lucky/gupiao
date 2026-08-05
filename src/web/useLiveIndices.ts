/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLiveIndices —— 共享实时指数 hook
 *  - 今日大盘页与市场地图页共用同一份实时行情数据，保证三大指数一致。
 *  - 模块级缓存：StrictMode 下 effect 会执行两次，用同一个 pending Promise 去重请求。
 */

import { useEffect, useState } from 'react';
import { webIndices } from './mockWebData';

export interface LiveIndex {
  code: string;
  name: string;
  value: number;
  changePercent: number;
  changeValue: number;
}

// 模块级缓存：StrictMode 下 effect 会执行两次，用同一个 pending Promise 去重请求
let cachedOverviewPromise: Promise<any> | null = null;
function fetchMarketOverview() {
  if (!cachedOverviewPromise) {
    cachedOverviewPromise = fetch('/api/market-overview')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('not ok'))))
      .catch((err) => {
        cachedOverviewPromise = null; // 失败则允许下次重试
        throw err;
      });
  }
  return cachedOverviewPromise;
}

export interface MarketStatusInfo {
  isOpen: boolean;
  phase: string;
  label: string;
}

export interface LiveIndicesState {
  /** null=加载中；加载完成前不渲染 mock，避免 mock→实时跳变闪烁 */
  indices: LiveIndex[] | null;
  /** 是否来自实时接口；拉取失败回退 mock 时为 false */
  isLive: boolean;
  /** 市场状态（盘中/午休/收盘/周末等），来自后端 getMarketStatus */
  marketStatus: MarketStatusInfo | null;
}

export function useLiveIndices(): LiveIndicesState {
  const [state, setState] = useState<LiveIndicesState>({ indices: null, isLive: false, marketStatus: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchMarketOverview();
        const raw = Array.isArray(data?.indices) && data.indices.length > 0 ? data.indices : null;
        if (!raw || cancelled) return;

        const merged: LiveIndex[] = webIndices.map((mock) => {
          const live = raw.find(
            (i: any) => (i.code || '').replace(/\.(SH|SZ|BJ)$/, '') === mock.code.replace(/\.(SH|SZ|BJ)$/, ''),
          );
          if (!live) return mock;
          const price = Number(live.price) || 0;
          const changePercent = Number(live.changePercent) || 0;
          // 反推涨跌点：prevClose = price / (1 + pct/100)，changeValue = price - prevClose
          const changeValue = Math.round((price - price / (1 + changePercent / 100)) * 100) / 100;
          return {
            code: mock.code,
            name: mock.name,
            value: price,
            changePercent,
            changeValue: Number.isFinite(changeValue) ? changeValue : 0,
          };
        });
        if (!cancelled) {
          setState({
            indices: merged,
            isLive: true,
            marketStatus: data?.marketStatus ?? null,
          });
        }
      } catch {
        // 拉取失败：回退静态 mock 一次性渲染（不再二次跳变）
        if (!cancelled) setState({ indices: webIndices, isLive: false, marketStatus: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
