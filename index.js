/* eslint-disable*/
var request = require('request');
var cheerio = require('cheerio');
var nodemailer = require('nodemailer');
var mongoose = require('mongoose');
var fs = require('fs');
var UserDataModel = require('./models/userDataModel');
var configObj = JSON.parse(fs.readFileSync('config/configuration.json', 'utf8'));

mongoose.connect(configObj.db_query, function(err, msg) {
    if (err) {
        console.log('Error connecting database ' + err.message);
    } else {
        console.log('Connected to database');
        authenticate();
    }
});

var row = [];
var current_stats;
var mailBody = '';
var currMailBody = '';
var localMsg = '';
var recordProcessed = 0;
var dataFromRouter = {};
var token = '';
var dateString = '';

var authenticationObj = {
    uri: 'http://192.168.0.1/userRpm/LoginRpm.htm?Save=Save',
    headers: {
        Host: '192.168.0.1',
        Connection: 'keep-alive',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Upgrade-Insecure-Requests': 1,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.87 Safari/537.36',
        Referer: 'http://192.168.0.1/',
        'Accept-Encoding': 'gzip, deflate, sdch',
        'Accept-Language': 'en-US,en;q=0.8,hi;q=0.6',
        Cookie: 'Authorization=Basic%20c2FraXZrczpkYWY4NmIzNzVmMDhjYzgyZWUyODlmZThhNmFkMDRlZA%3D%3D'
    }
};

function authenticate() {
    console.log('Sending Authentication request');
    request(authenticationObj, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            var rx = /192\.168\.0\.1\/(.*)\/userRpm/g;
            var arr = rx.exec(body);
            token = arr[1];
            console.log(`authentication token -> ${arr[1]}`);
        }
        getDataFromTPLINK();
    });
    console.log('gg wp');
}

function getDataFromTPLINK() {
    request(getOption(), function(error, response, body) {
        if (!error && response.statusCode === 200) {
            $ = cheerio.load(body);
            var data = $('SCRIPT')[0].children[0].data.split('=');
            var valuesData = eval(data[1]); // eslint-disable-line
            valuesData.forEach(function(entry, index, array) {
                if (index % 13 === 0 && index + 4 <= array.length) {
                    dataFromRouter[array[index + 2]] = array[index + 4];
                }
            });
            console.log('\n------------- Fetched data from Router');
            console.log(dataFromRouter);
            getData();
        }
    });
}

function getData() {
    // Max of data should be here
    try {
      UserDataModel.aggregate()
            .group({
                _id: '$device',
                created: {
                    $max: '$created'
                },
                data: {
                    $last: '$data'
                }
            })
            .exec(function(err, data) {
                if (!err) {
                    current_stats = data;
                    var luDt = new Date(data[0]['created']);
                    dateString = `${luDt.getDate()}-${monthNames[luDt.getMonth()]} ${luDt.getHours()}:${luDt.getMinutes()}:${luDt.getSeconds()}`;

                    console.log('\n------------ Fetched max and latest data from DB');
                    console.log(current_stats);
                    pushData();
                }
            });
    } catch (err) {
        console.log('Can not retrieve data pushing data');
        pushData();
    }
}

var num_of_rows_added = 0;

function pushData() {
    var mac_address, dataUsed, mailID, device, obj, current_data;
    for (var key in dataFromRouter) {
        if (dataFromRouter.hasOwnProperty(key)) {
            mac_address = key;
            dataUsed = bytes_to_mb(dataFromRouter[key]);
            if (configObj.mac_to_name_mail[mac_address]) {
                recordProcessed = recordProcessed + 1;
                mailID = configObj.mac_to_name_mail[mac_address][1];
                device = configObj.mac_to_name_mail[mac_address][0];

                if (current_stats.length > 0) {
                    obj = current_stats.filter(function(x) {
                        return x._id === device;
                    });
                    if (obj.length > 0) {
                        current_data = parseFloat(obj[0].data);
                    }
                } else {
                    current_data = 0;
                }
                console.log(device + ' \t', mac_address + ' -- ', gb(dataUsed), gb(current_data));
                if (dataUsed >= current_data) {
                    console.log('Router is not reset');
                    row = new UserDataModel({
                        'email': mailID,
                        'data': dataUsed,
                        'device': device
                    });
                    currMailBody = currMailBody + ' ' + device + ' :\t' + (dataUsed - current_data).toFixed(2) + ' MB\n\t';
                } else {
                    row = new UserDataModel({
                        'email': mailID,
                        'data': current_data + dataUsed,
                        'device': device
                    });
                    currMailBody = currMailBody + ' ' + device + ' :\t' + dataUsed.toFixed(2) + ' MB\n\t';
                }

                if (process.env.VIEW_ONLY !== 'true') {
                    row.save(function(err) {
                        if (err) {
                            console.log('Error Row not added, error:' + err.message);
                        } else {
                            console.log('Row added');
                            num_of_rows_added = num_of_rows_added + 1;
                            if (num_of_rows_added === recordProcessed) {
                                console.log('Last Row added');
                                console.log(currMailBody);
                                resetDataInTPLINK();
                            }
                        }
                    });
                }
            }
        }
    }
    if (process.env.VIEW_ONLY === 'true') {
        console.log('\n------------- Not updating DB');
        createMail();
    }
}

function resetDataInTPLINK() {
    request(resetObj(), function(error, response, body) {
        if (!error && response.statusCode === 200) {
            console.log('\n------------- DONE Reseting the data stats to 0.0 in the router');
            createMail();
        }
    });
}

function createMail() {
    // Max of data should be here
    UserDataModel.aggregate()
        .group({
            _id: '$device',
            created: {
                $max: '$created'
            },
            data: {
                $last: '$data'
            }
        })
        .exec(function(err, data) {
            if (err) {
                console.log('Can not retrieve data');
            } else {
                console.log(data);
                var total = 0;
                for (var i = 0; i < data.length; i++) {
                    localMsg = localMsg + data[i]['_id'] + ' :\t' + (data[i]['data'] / 1000).toFixed(3) + ' GB\n\t';
                    total += data[i]['data'];
                }

                // if (is_router_reset == true) {
                //     mailBody = mailBody + 'Someone has reset the router, current data might be inacurrate' + '\n';
                // }
                mailBody = mailBody + 'Total data used in GBs \n\t' + localMsg + '\n';
                mailBody += ` Total used -> ${(total / 1000).toFixed(3)} \n\n`;
                mailBody = mailBody + 'Data used in this session(since last db update at ' + dateString + ') in MBs \n\t' + currMailBody;
                if (process.env.SEND_MAIL === 'true') {
                    console.log('\n---------------Sending mail');
                    sendMail();
                } else {
                    console.log('\n---------------Not sending mail');
                }
                console.log('\n\n' + mailBody);
            }
        });
}

var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: configObj.auth
});

function bytes_to_mb(bytes) {
    return parseFloat(bytes / (1024 * 1024));
}

function sendMail() {
    var mailOptions = {
        from: configObj.host_address,
        to: configObj.recipients,
        subject: 'Data usage C-402 (Computer generated)',
        text: mailBody
    };
    transporter.sendMail(mailOptions, function(err, msg) {
        if (err) {
            console.log(err.message);
            process.exit();
        } else {
            console.log(msg);
            process.exit();
        }
    });
}

function getOption() {
    var options = {
        uri: `http://192.168.0.1/${token}/userRpm/SystemStatisticRpm.htm?interval=60&sortType=2&Num_per_page=20&Goto_page=1`,
        headers: {
            Host: '192.168.0.1',
            Connection: 'keep-alive',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Upgrade-Insecure-Requests': 1,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.87 Safari/537.36',
            Referer: `http://192.168.0.1/${token}/userRpm/SystemStatisticRpm.htm`,
            'Accept-Encoding': 'gzip, deflate, sdch',
            'Accept-Language': 'en-US,en;q=0.8,hi;q=0.6',
            Cookie: 'Authorization=Basic%20c2FraXZrczpkYWY4NmIzNzVmMDhjYzgyZWUyODlmZThhNmFkMDRlZA%3D%3D'
        }
    };
    return options;
}

function resetObj() {
    var options = {
        uri: `http://192.168.0.1/${token}/userRpm/SystemStatisticRpm.htm?ResetAll=All&interval=60&autoRefresh=0&sortType=2&Num_per_page=20&Goto_page=1`,
        headers: {
            Host: '192.168.0.1',
            Connection: 'keep-alive',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Upgrade-Insecure-Requests': 1,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.87 Safari/537.36',
            Referer: `http://192.168.0.1/${token}/userRpm/SystemStatisticRpm.htm`,
            'Accept-Encoding': 'gzip, deflate, sdch',
            'Accept-Language': 'en-US,en;q=0.8,hi;q=0.6',
            Cookie: 'Authorization=Basic%20c2FraXZrczpkYWY4NmIzNzVmMDhjYzgyZWUyODlmZThhNmFkMDRlZA%3D%3D'
        }
    };
    return options;
}

function gb(mb) {
    return (mb / 1000).toFixed(3);
}

var monthNames = [
    'January', 'February', 'March',
    'April', 'May', 'June', 'July',
    'August', 'September', 'October',
    'November', 'December'
];