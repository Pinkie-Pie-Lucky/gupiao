import { useState } from 'react';
import { BookOpen, ChevronRight, Home, Map, MessageCircle, Search, Sparkles, UserRound } from 'lucide-react';

type Theme = { name: string; change: number; reason: string; size: string };

const themes: Theme[] = [
  { name: '人工智能', change: 3.82, reason: '算力需求预期升温，资金集中流入科技方向。', size: 'large' },
  { name: '半导体', change: 2.61, reason: 'AI 产业链带动芯片与设备板块走强。', size: 'medium' },
  { name: '机器人', change: 2.18, reason: '政策与产业消息提升市场关注度。', size: 'medium' },
  { name: '黄金', change: 1.35, reason: '避险需求增加，资金流向贵金属方向。', size: 'small' },
  { name: '新能源', change: -0.72, reason: '市场情绪偏谨慎，板块小幅回调。', size: 'medium' },
  { name: '银行', change: -0.38, reason: '资金偏好成长方向，防御板块表现偏弱。', size: 'small' },
];

function BubbleAvatar({ small = false }: { small?: boolean }) {
  return <div className={`bubble-avatar ${small ? 'small' : ''}`} aria-label="泡泡 AI 助手">
    <span className="antenna" /><span className="eye left" /><span className="eye right" /><span className="shine" />
  </div>;
}

function Heatmap({ onPick }: { onPick: (theme: Theme) => void }) {
  return <div className="heatmap">
    {themes.map((theme) => <button key={theme.name} onClick={() => onPick(theme)} className={`heat-tile ${theme.change >= 0 ? 'up' : 'down'} ${theme.size}`}>
      <span>{theme.name}</span><b>{theme.change > 0 ? '+' : ''}{theme.change}%</b>
    </button>)}
  </div>;
}

function App() {
  const [market, setMarket] = useState<'A股' | '美股'>('A股');
  const [selected, setSelected] = useState<Theme | null>(null);
  const [activeTab, setActiveTab] = useState('首页');
  const nav = [{ label: '首页', icon: Home }, { label: '市场地图', icon: Map }, { label: '泡泡', icon: MessageCircle }, { label: '我的', icon: UserRound }];

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><BubbleAvatar small /><span>泡泡看市</span></div><button className="icon-button"><Search size={20} /></button></header>
    <section className="market-switch" aria-label="市场切换">{(['A股', '美股'] as const).map((item) => <button key={item} className={market === item ? 'active' : ''} onClick={() => setMarket(item)}>{item}</button>)}</section>
    <section className="hero-card">
      <BubbleAvatar />
      <div><p className="eyebrow"><Sparkles size={14} /> 泡泡的今日早报</p><h1>今天市场偏乐观，科技板块成了主角。</h1><p>AI、半导体领涨，成交额较昨日增加 <strong>12.4%</strong>。如果只记住一件事：今天资金正在流向科技成长方向。</p><div className="hero-actions"><button className="primary">查看原因 <ChevronRight size={16} /></button><button className="text-button">问问泡泡</button></div></div>
    </section>
    <section className="section"><div className="section-heading"><div><p className="eyebrow">{market} · 收盘</p><h2>今日市场概览</h2></div><span className="market-weather">☀️ 偏乐观</span></div>
      <div className="indices"><div><span>上证指数</span><b>3,286.42</b><em>+0.63%</em></div><div><span>深证成指</span><b>10,428.73</b><em>+1.12%</em></div><div><span>创业板指</span><b>2,117.56</b><em>+1.87%</em></div></div>
      <div className="volume"><div><span>今日成交额</span><b>1.62 万亿</b><small>比昨天多 12.4%，市场更活跃</small></div><div className="bar-chart"><i /><i /><i /><i /><i className="last" /></div></div>
    </section>
    <section className="section"><div className="section-heading"><div><p className="eyebrow">一眼看懂资金去哪了</p><h2>动态市场地图</h2></div><button className="link-button">查看全部 <ChevronRight size={16} /></button></div><Heatmap onPick={setSelected} /><p className="map-hint">颜色代表涨跌，面积代表市场关注度。点击任一板块，听泡泡解释。</p></section>
    <section className="section"><div className="section-heading"><div><p className="eyebrow">今天最受关注</p><h2>热点板块</h2></div></div><div className="hot-list">{themes.slice(0, 3).map((theme, index) => <button key={theme.name} onClick={() => setSelected(theme)} className="hot-row"><span className="rank">{['🥇', '🥈', '🥉'][index]}</span><div><b>{theme.name}</b><p>{theme.reason}</p></div><strong>+{theme.change}%</strong><ChevronRight size={17} /></button>)}</div></section>
    <section className="learn-card"><BookOpen size={22} /><div><p>今天学会</p><b>什么是“放量上涨”？</b><span>上涨时买卖的人变多，说明更多资金正在参与。</span></div><ChevronRight size={19} /></section>
    {selected && <div className="sheet-backdrop" onClick={() => setSelected(null)}><section className="detail-sheet" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><button className="close" onClick={() => setSelected(null)}>×</button><BubbleAvatar small /><p className="eyebrow">泡泡来解释</p><h2>{selected.name}今天{selected.change >= 0 ? '上涨' : '下跌'} <span className={selected.change >= 0 ? 'rise' : 'fall'}>{selected.change > 0 ? '+' : ''}{selected.change}%</span></h2><p className="detail-reason">{selected.reason}</p><div className="logic"><b>可能的市场逻辑</b><span>相关事件 / 预期变化</span><i>↓</i><span>资金关注度变化</span><i>↓</i><strong>{selected.name}{selected.change >= 0 ? '上涨' : '回调'} {selected.change > 0 ? '+' : ''}{selected.change}%</strong></div></section></div>}
    <nav className="bottom-nav">{nav.map(({ label, icon: Icon }) => <button key={label} className={activeTab === label ? 'active' : ''} onClick={() => setActiveTab(label)}><Icon size={21} fill={activeTab === label ? 'currentColor' : 'none'} /><span>{label}</span></button>)}</nav>
  </main>;
}

export default App;
