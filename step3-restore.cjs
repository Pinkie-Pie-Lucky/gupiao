const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = 'l:/原本是c盘的文档/泡泡看市/gupiao';
const DST = 'l:/原本是c盘的文档/泡泡看市/gupiao-repo';
const BACKUP = 'l:/原本是c盘的文档/泡泡看市';

function copy(srcRelative) {
  const src = path.join(SRC, srcRelative);
  const dst = path.join(DST, srcRelative);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return 'Copied';
  }
  return 'MISSING';
}

console.log('=== Restoring files to repo ===');

// 1. HomeTab.tsx
console.log('HomeTab:', copy('src/components/HomeTab.tsx'));

// 2. types.ts  
console.log('types:', copy('src/types.ts'));

// 3. MarketMapTab.tsx (already done)
console.log('MarketMapTab:', copy('src/components/MarketMapTab.tsx'));

// 4. BubbleAvatar.tsx (already done)
console.log('BubbleAvatar:', copy('src/components/BubbleAvatar.tsx'));

// 5. OneClickMarketModal.tsx (already done)
console.log('OneClickMarketModal:', copy('src/components/OneClickMarketModal.tsx'));

// 6. InteractiveChart.tsx
console.log('InteractiveChart:', copy('src/components/InteractiveChart.tsx'));

// 7. data.ts
console.log('data:', copy('src/data.ts'));

// 8. vite.config.ts
console.log('vite.config:', copy('vite.config.ts'));

// 9. App.tsx
console.log('App:', copy('src/App.tsx'));

// 10. main.tsx
console.log('main:', copy('src/main.tsx'));

// 11. index.css
console.log('index.css:', copy('src/index.css'));

// 12. Rest of components
['AiTeacherTab.tsx','FeedbackModal.tsx','MineTab.tsx','WatchlistTab.tsx'].forEach(f => {
  console.log(f+':', copy('src/components/'+f));
});

// Show status
console.log('\n=== Git Status ===');
console.log(execSync('git status --short', { cwd: DST, encoding:'utf-8' }));
console.log('Done');