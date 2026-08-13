/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MarketIndex, StockSector, PersonalizedAlert, UserProfile } from './types';

// Generate simulated history data
const generateHistory = (startVal: number, pointsCount = 30, volatility = 0.015) => {
  const history = [];
  let currentVal = startVal;
  for (let i = pointsCount; i >= 0; i--) {
    const change = currentVal * (Math.random() - 0.48) * volatility;
    currentVal = currentVal + change;
    history.push({
      time: `${9 + Math.floor((pointsCount - i) / 10)}:${String(((pointsCount - i) * 6) % 60).padStart(2, '0')}`,
      value: parseFloat(currentVal.toFixed(2)),
      volume: Math.floor(Math.random() * 50000 + 10000),
    });
  }
  return history;
};

export const initialIndices: MarketIndex[] = [
  {
    name: '上证指数',
    code: '000001.SH',
    value: 3026.49,
    changeValue: 21.65,
    changePercent: 0.72,
    history: generateHistory(3005, 40, 0.005),
  },
  {
    name: '深证成指',
    code: '399001.SZ',
    value: 9730.87,
    changeValue: 120.15,
    changePercent: 1.25,
    history: generateHistory(9610, 40, 0.007),
  },
  {
    name: '创业板指',
    code: '399006.SZ',
    value: 1905.15,
    changeValue: 27.76,
    changePercent: 1.48,
    history: generateHistory(1877, 40, 0.009),
  },
];

export const initialSectors: StockSector[] = [
  {
    id: 'ai-compute',
    name: 'AI算力',
    changePercent: 4.32,
    color: 'bg-red-500 hover:bg-red-600 text-white',
    description: '受大模型训练需求激增影响，高算力GPU、服务器及光模块等AI基础设施板块持续受到资金强力拉升，领涨大盘。',
    stocks: [
      {
        name: '寒武纪',
        code: '688256.SH',
        price: 284.5,
        changePercent: 8.45,
        volume: '4.2万手',
        turnover: '11.8亿元',
        history: generateHistory(262, 20, 0.03),
      },
      {
        name: '工业富联',
        code: '601138.SH',
        price: 22.85,
        changePercent: 5.12,
        volume: '45.1万手',
        turnover: '10.2亿元',
        history: generateHistory(21.7, 20, 0.02),
      },
      {
        name: '中科曙光',
        code: '603019.SH',
        price: 48.32,
        changePercent: 3.89,
        volume: '22.8万手',
        turnover: '10.9亿元',
        history: generateHistory(46.5, 20, 0.015),
      },
      {
        name: '中际旭创',
        code: '300308.SZ',
        price: 135.2,
        changePercent: 4.15,
        volume: '11.3万手',
        turnover: '15.1亿元',
        history: generateHistory(129.8, 20, 0.025),
      }
    ],
  },
  {
    id: 'semiconductor',
    name: '半导体',
    changePercent: 3.28,
    color: 'bg-red-400 hover:bg-red-500 text-white',
    description: '半导体国产替代率快速上升，存储芯片与先进代工需求旺盛。设备、EDA和高端IC设计环节今日主力资金净流入明显。',
    stocks: [
      {
        name: '中芯国际',
        code: '688981.SH',
        price: 53.42,
        changePercent: 4.21,
        volume: '38.4万手',
        turnover: '20.3亿元',
        history: generateHistory(51.2, 20, 0.02),
      },
      {
        name: '北方华创',
        code: '002371.SZ',
        price: 312.5,
        changePercent: 3.52,
        volume: '3.1万手',
        turnover: '9.6亿元',
        history: generateHistory(301.8, 20, 0.018),
      },
      {
        name: '韦尔股份',
        code: '603501.SH',
        price: 104.8,
        changePercent: 2.11,
        volume: '15.4万手',
        turnover: '16.1亿元',
        history: generateHistory(102.6, 20, 0.015),
      }
    ],
  },
  {
    id: 'robot',
    name: '机器人',
    changePercent: 2.45,
    color: 'bg-orange-500 hover:bg-orange-600 text-white',
    description: '具身智能与人形机器人利好频出，关节谐波减速器、伺服电机等核心零部件研发取得突破，吸引市场游资积极介入。',
    stocks: [
      {
        name: '绿的谐波',
        code: '688017.SH',
        price: 122.35,
        changePercent: 4.65,
        volume: '2.8万手',
        turnover: '3.4亿元',
        history: generateHistory(116.9, 20, 0.025),
      },
      {
        name: '科大讯飞',
        code: '002230.SZ',
        price: 45.12,
        changePercent: 2.85,
        volume: '28.9万手',
        turnover: '13.0亿元',
        history: generateHistory(43.8, 20, 0.018),
      },
      {
        name: '汇川技术',
        code: '300124.SZ',
        price: 60.18,
        changePercent: 0.98,
        volume: '8.4万手',
        turnover: '5.1亿元',
        history: generateHistory(59.6, 20, 0.012),
      }
    ],
  },
  {
    id: 'new-energy',
    name: '新能源',
    changePercent: -0.98,
    color: 'bg-emerald-500 hover:bg-emerald-600 text-white',
    description: '光伏产业链面临产能出清阶段，锂电池原材料价格小幅承压。虽然出口依然保持韧性，但日内市场资金偏向防守，呈现净流出态势。',
    stocks: [
      {
        name: '宁德时代',
        code: '300750.SZ',
        price: 168.45,
        changePercent: -1.23,
        volume: '18.2万手',
        turnover: '30.5亿元',
        history: generateHistory(170.5, 20, 0.015),
      },
      {
        name: '比亚迪',
        code: '002594.SZ',
        price: 245.3,
        changePercent: -0.65,
        volume: '4.8万手',
        turnover: '11.7亿元',
        history: generateHistory(246.9, 20, 0.01),
      },
      {
        name: '隆基绿能',
        code: '601012.SH',
        price: 18.52,
        changePercent: -2.15,
        volume: '125.1万手',
        turnover: '23.1亿元',
        history: generateHistory(18.9, 20, 0.015),
      }
    ],
  },
  {
    id: 'biomed',
    name: '医药生物',
    changePercent: 0.54,
    color: 'bg-red-300 hover:bg-red-400 text-white',
    description: '创新药医保谈判进展顺利，部分具备出海竞争力的生物药企盘中放量上攻。整体板块处于估值底部，展现出较强的抗跌防御属性。',
    stocks: [
      {
        name: '恒瑞医药',
        code: '600276.SH',
        price: 45.32,
        changePercent: 1.25,
        volume: '15.1万手',
        turnover: '6.8亿元',
        history: generateHistory(44.7, 20, 0.012),
      },
      {
        name: '迈瑞医疗',
        code: '300760.SZ',
        price: 288.6,
        changePercent: -0.42,
        volume: '1.2万手',
        turnover: '3.4亿元',
        history: generateHistory(289.8, 20, 0.008),
      }
    ],
  },
  {
    id: 'consumer',
    name: '白酒消费',
    changePercent: -0.45,
    color: 'bg-emerald-400 hover:bg-emerald-500 text-white',
    description: '国庆节后消费步入淡季，高档白酒渠道库存面临消化。中低端快消品受制于促销减弱表现平淡，板块今日呈缩量盘整。',
    stocks: [
      {
        name: '贵州茅台',
        code: '600519.SH',
        price: 1650.0,
        changePercent: -0.32,
        volume: '4.1万手',
        turnover: '67.6亿元',
        history: generateHistory(1655, 20, 0.006),
      },
      {
        name: '五粮液',
        code: '000858.SZ',
        price: 138.4,
        changePercent: -0.85,
        volume: '9.2万手',
        turnover: '12.7亿元',
        history: generateHistory(139.5, 20, 0.008),
      }
    ],
  }
];

export const initialAlerts: PersonalizedAlert[] = [
  {
    id: 'alert-1',
    title: '泡泡老师个性化提醒',
    content: '您关注的AI板块资金流出，建议注意风险。',
    sectorId: 'ai-compute',
    type: 'warning',
    time: '10:45',
    fullAnalysis: `尊敬的投资者：

【今日预警】截至10点45分，您持仓/关注的**AI算力**板块出现高位筹码松动迹象。主力资金净流出约23.5亿元，其中光模块龙头主力资金流出额最大。

【深度剖析】
1. **获利盘了结**：AI算力板块过去一周累计涨幅超过15%，积累了大量短期获利盘。在今日大盘拉升至3026点附近时，部分前期套牢盘与短线获利资金选择逢高离场。
2. **多空博弈白热化**：尽管今日部分股票表现抢眼（如寒武纪大涨+8.45%），但板块整体呈现分化。中科曙光、工业富联的主力流入显著放缓，大单抛压增大。
3. **技术面承压**：光模块指数已贴近布林线上轨，KDJ指标处于超买区，短期有技术性回撤修复需求。

【操作建议】
- **控制仓位**：建议将短期浮盈仓位适当止盈，仓位控制在4成以下。
- **不要盲目追高**：切勿在板块冲高时追加仓位，等待缩量回踩年线或重要均线确认支撑后再做中线布局。
- **关注轮动机会**：由于今日主力资金流出AI板块后开始流入估值洼地的半导体及机器人概念，建议关注这两个板块的低吸机会。`,
  },
  {
    id: 'alert-2',
    title: '半导体板块机会提示',
    content: '半导体国产设备股逆势放量，关注补涨机会。',
    sectorId: 'semiconductor',
    type: 'success',
    time: '09:50',
    fullAnalysis: `尊敬的投资者：

【今日亮点】今日开盘后，**半导体**板块，尤其是半导体国产设备股表现异常坚挺，主力净流入约15.8亿元。

【深度剖析】
1. **政策推动利好**：最新科技强国战略部署进一步突出了半导体装备国产化的迫切性，多地产业基金宣布新一期半导体扶持项目落地。
2. **量价齐升**：中芯国际大涨+4.21%领衔，北方华创亦放量突破前期阻力位。板块成交量比昨日同期放大40%，属于健康的“温和放量”状态。
3. **资金回流**：部分从AI算力流出的套利资金，在寻找风险收益比更佳的去处，估值相对合理的半导体设备由于具备长远确定性，成为资金首选。

【操作建议】
- **重点锁定龙头**：北方华创、中芯国际等高壁垒标的为核心关注对象。
- **配置策略**：可采取“金字塔分批建仓法”，逢回调时适当加仓。中线持有，止损线设在前期底部支撑位。`,
  }
];

export const mockUserProfile: UserProfile = {
  name: '泡泡老股民',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
  riskTolerance: '平衡型',
  followedSectors: ['ai-compute', 'semiconductor'],
  virtualBalance: 500000,
};

export function getChineseWeekday(date: Date): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[date.getDay()];
}

export function formatChineseDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = getChineseWeekday(date);
  return `${month}月${day}日 ${weekday}`;
}
