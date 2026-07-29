const {execSync}=require('child_process');
const dir='l:/原本是c盘的文档/泡泡看市/gupiao-repo';
console.log(execSync('git status --short', {cwd:dir, encoding:'utf-8'}));
console.log(execSync('git push origin feat/market-stories 2>&1', {cwd:dir, encoding:'utf-8', stdio:'pipe'}));