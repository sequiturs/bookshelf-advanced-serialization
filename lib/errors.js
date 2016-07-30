'use strict';

var createError = require('create-error');

module.exports = {

  // Thrown when invalid arguments are provided to the plugin's methods
  BookshelfPermissionBasedSerializationPluginSanityError:
    createError('BookshelfPermissionBasedSerializationPluginSanityError')

};
