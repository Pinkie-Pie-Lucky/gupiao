const {execSync}=require('child_process');
console.log(execSync('git stash push -m "backup-restored-files"',{cwd:__dirname,encoding:'utf-8',stdio:'pipe'}));
console.log(execSync('git checkout feat/market-stories',{cwd:__dirname,encoding:'utf-8',stdio:'pipe'}));
console.log(execSync('git stash pop',{cwd:__dirname,encoding:'utf-8',stdio:'pipe'}));
console.log('DONE - on feat/market-stories');