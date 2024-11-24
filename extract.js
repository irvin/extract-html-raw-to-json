const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const vm = require('vm');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// Worker 線程的邏輯
if (!isMainThread) {
  const { filePath, index, total, sourceDir, destinationDir } = workerData;
  
  async function processFile() {
    try {
      const result = await parseFileSavetoJson(filePath, index, total, sourceDir, destinationDir);
      parentPort.postMessage({ success: true, filePath });
    } catch (error) {
      parentPort.postMessage({ success: false, filePath, error: error.message });
    }
  }

  processFile();
  return;
}

// 主線程的邏輯

// 從命令列參數取得目錄路徑
const dir = process.argv[2]; // 第三個參數是來源目錄路徑
const destDir = process.argv[3]; // 第四個參數是目標目錄路徑
const numCPUs = process.argv[4] || os.cpus().length; // 使用 CPU 核心數

if (!dir || !destDir) {
  console.error('請提供來源目錄和目標目錄作為命令列參數');
  process.exit(1);
}

// 建立 Worker Pool
function createWorkerPool(files) {
  const workers = new Set();
  let fileIndex = 0;
  const totalFiles = files.length;

  return new Promise((resolve, reject) => {
    const startWorker = () => {
      if (fileIndex >= files.length) {
        if (workers.size === 0) resolve();
        return;
      }

      const worker = new Worker(__filename, {
        workerData: {
          filePath: files[fileIndex],
          index: fileIndex,
          total: totalFiles,
          sourceDir: dir,
          destinationDir: destDir
        }
      });

      workers.add(worker);
      fileIndex++;

      worker.on('message', (message) => {
        if (message.success) {
          console.log(`Successfully processed: ${message.filePath}`);
        } else {
          console.error(`Error processing ${message.filePath}: ${message.error}`);
        }
        workers.delete(worker);
        worker.terminate();
        startWorker();
      });

      worker.on('error', (error) => {
        workers.delete(worker);
        worker.terminate();
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
        workers.delete(worker);
        startWorker();
      });
    };

    // 啟動初始的 worker 數量
    for (let i = 0; i < Math.min(numCPUs, files.length); i++) {
      startWorker();
    }
  });
}

// 主程序執行邏輯
(async function() {
  try {
    console.log(`使用 ${numCPUs} 個 CPU 核心進行處理`);
    const htmlFiles = await getHtmlFiles(dir);
    await createWorkerPool(htmlFiles);
    console.log('所有檔案處理完成');
  } catch (err) {
    console.error('Error processing directory', err);
  }
})();


function extractRawHtmlContent(rawHtml) {
  let authorObj = null;
  let contents = [];

  const obj = vm.runInNewContext('var window = {}; var Fusion = window.Fision = {};' + rawHtml + ';Fusion;');

  if ((!obj) || (!obj.globalContent) || (!obj.globalContent.content_elements)) return [null, null];

  // console.log('obj.globalContent', obj.globalContent, typeof obj.globalContent);

  obj.globalContent.content_elements.forEach(item => {
    if (item && item.content && item.type === 'raw_html')
      contents.push(item.content);

    if (item && item.content && item.type === 'text')
      contents.push(item.content);
  });
  // console.log('contents', contents);

  return [contents, authorObj];
}

// 清除 raw content 中的 html tag
function removeHtmlTags(array) {
  array = array.map(item => item.replace(/<[^>]*>/g, ''));  // htmlTag
  array = array.map(item => item.replace(/\r$/g, ''));   // trailingR

  // check whole array and pop non-wanted items
  array = array.filter(item => !item.includes('在APP內訂閱'));
  return array;
}

// 讀取 HTML 文件，提取 JSON-LD 資料，存成 JSON 檔案
async function parseFileSavetoJson(fileName, index, total, sourceDir, destinationDir) {
  console.log(`(${index + 1}/${total}) read file: ${fileName}`);

  try {
    let res = {};

    const htmlContent = await fs.readFile(fileName, 'utf8');
    const $ = cheerio.load(htmlContent);

    // 提取 <script type="application/ld+json"> 標籤的內容
    const jsonLdScript = $('script[type="application/ld+json"]').html();
    const jsonLdData = JSON.parse(jsonLdScript);

    if (jsonLdData) {
      res = {
        ...res,
        '@id': jsonLdData.mainEntityOfPage['@id'],
        articleSection: jsonLdData.articleSection,
        description: jsonLdData.description.trim(),
        dateModified: jsonLdData.dateModified,
        datePublished: jsonLdData.datePublished,
        headline: jsonLdData.headline,
        keywords: jsonLdData.keywords
      };
    }

    // generate id from file path
    if (!res['@id']) res['@id'] = `${fileName.replace('folder/', '').replace('index.html', '')}`;

    // 提取 <script id="fusion-metadata" type="application/javascript"> 標籤的內容
    let fuMetadata = $('script[id="fusion-metadata"]').html();

    // console.log('fuMetadata', fuMetadata);

    if (fuMetadata) {
      var [rawContents, authorObj] = extractRawHtmlContent(fuMetadata);
      if (rawContents) res.raw_content = removeHtmlTags(rawContents);
      if (authorObj) res.author = authorObj;
    }

    // console.log(res, res.length, Object.keys(res).length > 1);

    if (!(Object.keys(res).length > 1)) return;

    const jsonString = JSON.stringify(res, null, 2);

    // 計算目標檔案路徑
    const relativePath = path.relative(sourceDir, fileName);
    const jsonFilePath = path.join(destinationDir, relativePath).replace('.html', '.json');

    // 確保目標目錄存在
    await fs.mkdir(path.dirname(jsonFilePath), { recursive: true });

    await fs.writeFile(jsonFilePath, jsonString);
    console.log(`(${index + 1}/${total}) Successfully wrote: ${jsonFilePath}`);
  } catch (err) {
    console.error(`Error processing file ${fileName}`, err);
    throw err; // 重新拋出錯誤以便 worker 可以捕獲
  }
}

// 遍歷目錄列出所有 .html 檔案
async function getHtmlFiles(dir) {
  const files = await fs.readdir(dir, { recursive: true });
  return files
    .map(file => path.join(dir, file))
    .filter(file => path.extname(file) === '.html');
}