const fs = require('fs');
const path = require('path');

// 用來儲存已處理過的 ID，避免重複
const processedIds = new Set();
// 用來記錄重複的檔案
const duplicateFiles = [];

// 遍歷目錄的函數
function walkDir(dir, targetBaseDir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      walkDir(fullPath, targetBaseDir);
    } else if (file.endsWith('.json')) {
      processJsonFile(fullPath, targetBaseDir);
    }
  });
}

// 處理單一 JSON 檔案
function processJsonFile(filePath, targetBaseDir) {
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const id = content['@id'];
    
    // 解析 URL
    const match = id.match(/appledaily\.com\/([^\/]+)\/(\d{8})\/([^\/]+?)(?:\/index\.html)?(?:\/)?$/);
    if (!match) return;
    
    const [, category, date, hash] = match;
    
    // 檢查是否重複
    const newId = `https://tw.appledaily.com/${category}/${date}/${hash}/`;
    if (processedIds.has(newId)) {
      duplicateFiles.push({
        originalPath: filePath,
        duplicateId: newId
      });
      return;
    }
    
    // 記錄已處理的 ID
    processedIds.add(newId);
    
    // 建立目標目錄
    const targetDir = path.join(targetBaseDir, category, date, hash);
    fs.mkdirSync(targetDir, { recursive: true });
    
    // 更新 @id
    content['@id'] = newId;
    
    // 寫入新檔案
    fs.writeFileSync(
      path.join(targetDir, 'index.json'),
      JSON.stringify(content, null, 2)
    );
    
  } catch (err) {
    console.error(`處理檔案 ${filePath} 時發生錯誤:`, err);
  }
}

// 主程式
function main() {
  // 檢查命令列參數
  if (process.argv.length !== 4) {
    console.log('使用方式: node process_json.js <來源目錄> <目標目錄>');
    process.exit(1);
  }

  const sourceDir = process.argv[2];
  const targetDir = process.argv[3];

  // 檢查來源目錄是否存在
  if (!fs.existsSync(sourceDir)) {
    console.error(`錯誤：來源目錄 "${sourceDir}" 不存在`);
    process.exit(1);
  }

  // 建立目標根目錄
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir);
  }
  
  // 開始處理
  console.log(`開始處理：從 ${sourceDir} 到 ${targetDir}`);
  walkDir(sourceDir, targetDir);
  
  // 輸出重複檔案報告
  if (duplicateFiles.length > 0) {
    console.log('\n發現重複的檔案:');
    duplicateFiles.forEach(({ originalPath, duplicateId }) => {
      console.log(`檔案路徑: ${originalPath}`);
      console.log(`重複的 ID: ${duplicateId}\n`);
    });
  }

  console.log('處理完成！');
}

main(); 