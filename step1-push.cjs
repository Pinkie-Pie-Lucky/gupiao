const {execSync}=require('child_process');
const dir='l:/原本是c盘的文档/泡泡看市/gupiao-repo';
try {
  console.log('1. Adding files...');
  execSync('git add .', {cwd:dir, encoding:'utf-8', stdio:'pipe'});
  console.log('2. Committing...');
  execSync('git commit -m "chore: sync feat/market-stories"', {cwd:dir, encoding:'utf-8', stdio:'pipe'});
  console.log('3. Pushing to GitHub...');
  const r = execSync('git push origin feat/market-stories', {cwd:dir, encoding:'utf-8', stdio:'pipe'});
  console.log(r || 'Done');
} catch(e) {
  const msg = e.stderr || e.message;
  if (msg.includes('nothing to commit')) console.log('Nothing to commit, already up to date');
  else console.log('Error:', msg);
}