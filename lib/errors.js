'use strict';

var createError = require('create-error');

module.exports = {
  /**
   * @ignore
   * @desc Thrown when invalid arguments are provided to the plugin's methods.
   */
  BookshelfAdvancedSerializationPluginSanityError:
    createError('BookshelfAdvancedSerializationPluginSanityError')

};
