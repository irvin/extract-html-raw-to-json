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
      
      const match = id.match(/appledaily\.com\/([^\/]+)\/(\d{8})\/([^\/]+?)(?:\/index\.html)?(?:\/)?$/);
      if (!match) return null;
      
      const [, category, date, hash] = match;
      const newId = `https://tw.appledaily.com/${category}/${date}/${hash}/`;
      
      // 回傳結果給主線程
      return {
        newId,
        category,
        date,
        hash,
        content
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
  let completedTasks = 0;
  
  return new Promise((resolve, reject) => {
    const workers = new Set();
    let fileIndex = 0;
    const totalFiles = files.length;

    const updateProgress = () => {
      const percentage = ((completedTasks / totalFiles) * 100).toFixed(2);
      process.stdout.write(`處理進度: ${completedTasks}/${totalFiles} (${percentage}%)\r`);
    };

    // ... 其餘 Worker Pool 邏輯與 extract.js 類似 ...
    const startWorker = () => {
      if (fileIndex >= files.length) {
        if (completedTasks === files.length) {
          console.log('\n處理完成！');
          resolve({ processedIds, duplicateFiles });
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

      worker.on('message', ({ success, result, index }) => {
        completedTasks++;
        
        if (success && result) {
          if (processedIds.has(result.newId)) {
            duplicateFiles.push({
              originalPath: files[index],
              duplicateId: result.newId
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
          }
        }

        updateProgress();
        worker.terminate();
        workers.delete(worker);
        
        if (fileIndex < files.length) {
          startWorker();
        }
      });

      // ... worker 錯誤處理邏輯 ...
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

  console.log(`開始處理：從 ${sourceDir} 到 ${targetDir}`);
  console.log(`使用 ${numCPUs} 個 CPU 核心進行處理`);

  const files = [];
  walkDir(sourceDir, files);
  
  const { duplicateFiles } = await createWorkerPool(files, targetDir, numCPUs);

  if (duplicateFiles.length > 0) {
    console.log('\n發現重複的檔案:');
    duplicateFiles.forEach(({ originalPath, duplicateId }) => {
      console.log(`檔案路徑: ${originalPath}`);
      console.log(`重複的 ID: ${duplicateId}\n`);
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