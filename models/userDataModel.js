var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var userDataModelVikas = new Schema({
    email: {type: String},
    created: {type: Date, default: Date.now},
    data: {type: Number},
    device: {type: String}
});

module.exports = mongoose.model('UserDataModelVikas', userDataModelVikas);
