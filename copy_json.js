const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Worker 線程的邏輯
if (!isMainThread) {
  const { filePath, targetBaseDir, index, total } = workerData;
  
  function processJsonFile(filePath, targetBaseDir) {
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const id = content['@id'];
      
      // 清理 raw_content 陣列中的空字串
      if (content.raw_content && Array.isArray(content.raw_content)) {
        content.raw_content = content.raw_content.filter(item => item.trim() !== '');
      }
      
      const match = id.match(/appledaily\.com\/([^\/]+)\/(\d{8})\/([^\/]+?)(?:\/index\.html)?(?:\/)?$/);
      if (!match) return null;
      
      const [, category, date, hash] = match;
      const newId = `https://tw.appledaily.com/${category}/${date}/${hash}/`;
      
      // 檢查目標檔案是否已存在
      const targetDir = path.join(targetBaseDir, category, date, hash);
      const targetFile = path.join(targetDir, 'index.json');
      const fileExists = fs.existsSync(targetFile);
      
      return {
        newId,
        category,
        date,
        hash,
        content,
        fileExists
      };
    } catch (err) {
      throw new Error(`處理檔案 ${filePath} 時發生錯誤: ${err.message}`);
    }
  }

  try {
    const result = processJsonFile(filePath, targetBaseDir);
    parentPort.postMessage({ success: true, result, index });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message, index });
  }
  return;
}

// 主線程的邏輯
async function createWorkerPool(files, targetBaseDir, numCPUs) {
  const processedIds = new Set();
  const duplicateFiles = [];
  const errorFiles = [];
  let completedTasks = 0;
  let successfulCopies = 0;
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const workers = new Set();
    let fileIndex = 0;
    const totalFiles = files.length;

    const updateProgress = () => {
      const percentage = ((completedTasks / totalFiles) * 100).toFixed(2);
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(
        `\r[${elapsedTime}s] 處理進度: ${completedTasks}/${totalFiles} (${percentage}%) ` +
        `| 成功: ${successfulCopies} | 重複: ${duplicateFiles.length} | 錯誤: ${errorFiles.length}`
      );
    };

    const startWorker = () => {
      if (fileIndex >= files.length) {
        if (completedTasks === files.length) {
          const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log('\n\n=== 統計資訊 ===');
          console.log(`總執行時間: ${totalTime} 秒`);
          console.log(`總檔案數: ${totalFiles}`);
          console.log(`成功複製: ${successfulCopies}`);
          console.log(`重複檔案: ${duplicateFiles.length}`);
          console.log(`處理失敗: ${errorFiles.length}`);
          console.log(`平均處理速度: ${(totalFiles / totalTime).toFixed(1)} 檔案/秒`);
          resolve({ processedIds, duplicateFiles, errorFiles });
        }
        return;
      }

      const worker = new Worker(__filename, {
        workerData: {
          filePath: files[fileIndex],
          targetBaseDir,
          index: fileIndex,
          total: totalFiles
        }
      });

      workers.add(worker);
      fileIndex++;

      worker.on('message', ({ success, result, error, index }) => {
        completedTasks++;
        
        if (success && result) {
          if (processedIds.has(result.newId) || result.fileExists) {
            duplicateFiles.push({
              originalPath: files[index],
              duplicateId: result.newId,
              reason: result.fileExists ? '目標檔案已存在' : '重複的 ID'
            });
          } else {
            processedIds.add(result.newId);
            const targetDir = path.join(targetBaseDir, result.category, result.date, result.hash);
            fs.mkdirSync(targetDir, { recursive: true });
            
            result.content['@id'] = result.newId;
            fs.writeFileSync(
              path.join(targetDir, 'index.json'),
              JSON.stringify(result.content, null, 2)
            );
            successfulCopies++;
          }
        } else if (!success) {
          errorFiles.push({
            path: files[index],
            error: error
          });
        }

        updateProgress();
        worker.terminate();
        workers.delete(worker);
        
        if (fileIndex < files.length) {
          startWorker();
        }
      });

      worker.on('error', (err) => {
        errorFiles.push({
          path: files[fileIndex - 1],
          error: err.message
        });
        worker.terminate();
        workers.delete(worker);
        startWorker();
      });
    };

    // 啟動初始的 worker 數量
    const initialWorkers = Math.min(numCPUs, files.length);
    for (let i = 0; i < initialWorkers; i++) {
      startWorker();
    }
  });
}

// 主程式
async function main() {
  // 檢查命令列參數
  if (process.argv.length !== 5) {
    console.log('使用方式: node process_json.js <來源目錄> <目標目錄> <CPU 核心數>');
    process.exit(1);
  }

  const sourceDir = process.argv[2];
  const targetDir = process.argv[3];
  const numCPUs = parseInt(process.argv[4]) || os.cpus().length;

  console.log('=== 開始處理 ===');
  console.log(`來源目錄: ${sourceDir}`);
  console.log(`目標目錄: ${targetDir}`);
  console.log(`CPU 核心數: ${numCPUs}`);
  console.log('===============\n');

  const files = [];
  walkDir(sourceDir, files);
  console.log(`找到 ${files.length} 個 JSON 檔案\n`);
  
  const { duplicateFiles, errorFiles } = await createWorkerPool(files, targetDir, numCPUs);

  if (duplicateFiles.length > 0) {
    console.log('\n=== 重複的檔案 ===');
    duplicateFiles.forEach(({ originalPath, duplicateId, reason }) => {
      console.log(`檔案路徑: ${originalPath}`);
      console.log(`重複的 ID: ${duplicateId}`);
      console.log(`原因: ${reason}`);
      console.log('---');
    });
  }

  if (errorFiles.length > 0) {
    console.log('\n=== 處理失敗的檔案 ===');
    errorFiles.forEach(({ path, error }) => {
      console.log(`檔案路徑: ${path}`);
      console.log(`錯誤訊息: ${error}`);
      console.log('---');
    });
  }
}

// 修改 walkDir 函數來收集檔案路徑
function walkDir(dir, files) {
  const items = fs.readdirSync(dir);
  
  items.forEach(item => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      walkDir(fullPath, files);
    } else if (item.endsWith('.json')) {
      files.push(fullPath);
    }
  });
}

main().catch(console.error); 