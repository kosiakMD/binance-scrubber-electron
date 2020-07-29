const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');

const __DEV__ = false;
global.ENV = { __DEV__, VERSION: app.getVersion() };
const URI = 'https://api.binance.com';
const apiKey = '140493oEKy9fmAzF8qY4trdc7wkNPtXwMFfuuf65x4o35BtgMontGV40kJDd8783';
const secretKey = 'NLrN6IDMPsQg1kVP4kHWr95rw6LF7faWSnr5GnfTfVhTjc1g7aUePqw9OfTyBBxW';
const defaultSymbol = 'USDT';
const filePath = '__temp';
const fileName = 'Binance';
const fileExtension = 'xlsx';
const xlsFilePath = `${filePath}/${fileName}.${fileExtension}`;
const prices = [];
const missedPrices = [];

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 450,
    height: 450,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  // and load the index.html of the app.
  win.loadFile('view/index.html');

  ipcMain.on('getPrices', () => getAllPairs(win));
  ipcMain.on('downloadFile', () => {

    const { dialog } = require('electron');
    // console.log(dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }));
    // console.log(dialog.showSaveDialog(win, {
    const path = dialog.showSaveDialogSync(win, {
      defaultPath: fileName,
      filters: [{
        name: 'XLSX',
        extensions: [fileExtension],
      }],
      title: `${fileName}.${fileExtension}`,
      nameFieldLabel: `Default name: ${fileName}.${fileExtension}`,
      // defaultPath: '/',
      message: 'Save to',
      // properties: { createDirectory: true },
      properties: ['createDirectory'],
    });
    // if saving is not canceled
    if (path) {
      console.log('path', path);
      console.log('xlsFilePath', xlsFilePath);
      // fs.readFileSync(xlsFilePath, (document) => {
      //   console.log('document', document);
      const tempPath = path.split('/');
      const tempName = tempPath[tempPath.length - 1];
      // let newName = `${fileName}.${fileExtension}`;
      // if (tempName && tempName.split('.')[0]) {
      //     newName = tempName;
      //   }
      // }
      const newPath = tempPath.join('/');
      // fs.copyFileSync(document, newPath);
      console.log('newPath', newPath);
      fs.copyFileSync(xlsFilePath, newPath);
      // });
    }
  });

  // Open the DevTools.
  __DEV__ && win.webContents.openDevTools();

  win.webContents.session.on('will-download', (event, item, webContents) => {
    // Set the save path, making Electron not to prompt a save dialog.
    item.setSavePath('/tmp/save.pdf');

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed');
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused');
        } else {
          console.log(`Received bytes: ${item.getReceivedBytes()}`);
        }
      }
    });
    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully');
      } else {
        console.log(`Download failed: ${state}`);
      }
    });
  });
}

function getMarginPriceIndex(pair, onSuccess, onError) {
  return new Promise((resolve, reject) => {
    if (!pair) return resolve();

    const url = `${URI}/sapi/v1/margin/priceIndex?symbol=${pair}`; // &timestamp=${timestamp}&signature=${signature}
    // console.log('URL', url);
    const { net } = require('electron');
    const request = net.request(url);
    request.setHeader('X-MBX-APIKEY', apiKey);
    request.on('response', (response) => {
      // console.log(`STATUS: ${response.statusCode}`);
      // console.log(`HEADERS: ${JSON.stringify(response.headers)}`);
      response.on('data', (chunk) => {
        onSuccess && onError && onSuccess();
        // console.log(`BODY: ${chunk}`);
        const data = JSON.parse(chunk);
        // console.log('pair:', pair, '\nSymbol:', data.symbol, '\nPrice:', data.price, '\n');
        resolve({
          pair,
          symbol: data.symbol,
          price: data.price,
        });
      });
      response.on('error', (error) => {
        console.log('ERROR:', error);
        onSuccess && onError && onError(error) || onSuccess && !onError && onSuccess(error);
        reject(error);
      });
      // response.on('end', () => {
      //   console.log('-------------');
      // });
    });
    request.end();
  });
}

function getAllPairs(win) {
  const url = `${URI}/sapi/v1/margin/allPairs`; // ?timestamp={{timestamp}}&signature={{signature}}
  console.log('URL', url);
  const { net } = require('electron');
  const request = net.request(url);
  request.setHeader('X-MBX-APIKEY', apiKey);
  request.on('response', (response) => {
    console.log(`STATUS: ${response.statusCode}`);
    // console.log(`HEADERS: ${JSON.stringify(response.headers)}`);
    response.on('data', (chunk) => {
      // console.log(`BODY: ${chunk}`);
      const data = JSON.parse(chunk) || {};
      console.log(data.length);
      win.webContents.send('count', data.length);
      let success = 0;
      let errors = 0;
      const onSuccess = () => {
        success++;
        const status = `${success}/${data.length}`;
        console.log('status', status);
        win.webContents.send('status', status);
      };
      const onError = () => {
        errors++;
      };
      Promise.allSettled(data.map(({ symbol }) => {
        // console.log('Get', symbol);
        return getMarginPriceIndex(symbol, onSuccess, onError);
      })).then((pairs) => {
        console.log('DONE');
        // console.log(data);
        // console.log(pairs);
        pairs.map(({ status, value }) => {
          if (status === 'fulfilled') {
            const { symbol, pair } = value;
            if (symbol) {
              prices.push(value);
            } else {
              // missedPrices.push(pair);
              prices.push({ symbol: pair, price: '' });
            }
          }
        });
        win.webContents.send('done', prices, data);
        createNewExcelFile(prices, missedPrices, data).catch((error) => {
          console.log('ERROR:', error);
        });
      });
    });
    response.on('end', () => {
      console.log('-------------');
    });
  });
  request.end();
}

async function createNewExcelFile(prices, missedPrices, data) {
  console.log('Creating EXCEL Doc');
  const Excel = require('exceljs');
  // A new Excel Work Book
  const workbook = new Excel.Workbook();

  // Some information about the Excel Work Book.
  workbook.creator = 'KosiakMD';
  workbook.lastModifiedBy = '';
  workbook.created = new Date();
  workbook.modified = new Date();
  // workbook.lastPrinted = new Date();

  // Create a sheet
  const sheet1 = workbook.addWorksheet('Prices');
  // A table header
  sheet1.columns = [
    { header: '№', key: 'id' },
    { header: 'Symbol', key: 'symbol' },
    { header: 'Course', key: 'course' },
  ];
  //
  prices.map(({ symbol, price }, index) => {
    // console.log(symbol, price);
    sheet1.addRow({
      id: index + 1, course: '' + price, symbol: symbol,
    });
  });
  // const length = prices.length;
  // missedPrices.map((symbol, index) => {
  //   sheet1.addRow({
  //     id: length + index + 1,  symbol, course: '',
  //   });
  // });

  // Create a sheet 2
  const sheet2 = workbook.addWorksheet('Data');
  // A table header
  sheet2.columns = [
    { header: '№', key: 'id' },
    {
      header: '№',
      key: 'symbol',
    },
    {
      header: 'Base',
      key: 'base',
    },
    {
      header: 'Quote',
      key: 'quote',
    },
    {
      header: 'Margin Trade',
      key: 'isMarginTrade',
    },
    {
      header: 'Buy',
      key: 'isBuyAllowed',
    },
    {
      header: 'Sell',
      key: 'isSellAllowed',
    },
  ];
  //
  data.map(({ symbol, base, quote, isMarginTrade, isBuyAllowed, isSellAllowed }, index) => {
    // console.log(symbol);
    sheet2.addRow({
      id: index + 1,
      symbol,
      base,
      quote,
      isMarginTrade: isMarginTrade ? '+' : '',
      isBuyAllowed: isBuyAllowed ? '+' : '',
      isSellAllowed: isSellAllowed ? '+' : '',
    });
  });
  // create temp folder if not
  console.log('fs.existsSync(filePath)', fs.existsSync(filePath));
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(filePath);
  }
  // Save Excel on Hard Disk
  console.log('Creating File');
  await workbook.xlsx.writeFile(xlsFilePath);

  // Success Message
  return console.log('File Saved');
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
