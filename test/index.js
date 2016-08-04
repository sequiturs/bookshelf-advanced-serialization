'use strict';

var expect = require('expect.js');

var plugin = require('../lib/index.js');
var SanityError = require('../lib/errors.js').BookshelfAdvancedSerializationPluginSanityError;

describe('Plugin', function() {
  describe('options', function() {
    it('should accept not passing an options argument', function() {

    });
    it('should accept an options argument that is an object', function() {

    });
    it('should reject a truthy options argument that is not an object', function() {

    });
    describe('options.getEvaluatorArguments', function() {
      it('should accept not passing the option', function() {

      });
      it('should accept passing a function', function() {

      });
      it('should reject passing something truthy that is not a function', function() {
        expect(function() {
          plugin({ getEvaluatorArguments: 'foo' });
        }).to.throwException(function (e) {
          expect(e).to.be.a(SanityError);
          expect(e.message).to.equal('Truthy getEvaluatorArguments passed as plugin option must be a function.');
        });
      });
    });
    describe('options.handleEnsureRelation', function() {
      it('should accept not passing the option', function() {

      });
      it('should accept passing a function', function() {

      });
      it('should reject passing something truthy that is not a function', function() {
        expect(function() {
          plugin({ handleEnsureRelation: 'foo' });
        }).to.throwException(function (e) {
          expect(e).to.be.a(SanityError);
          expect(e.message).to.equal('Truthy handleEnsureRelation passed as plugin option must be a function.');
        });
      });
    });
    describe('options.ensureRelationsVisibleAndInvisible', function() {
      it('should accept not passing the option', function() {

      });
      it('should accept passing `true`', function() {

      });
      it('should accept passing `false`', function() {

      });
      it('should cast something truthy to `true`', function() {

      });
      it('should cast something falsy to `false`', function() {

      });
    });
  });
});

describe('Model', function() {
  describe('accessor', function() {
    it('should default to setting a null accessor', function() {

    });
  });
  describe('_accessedAsRelationChain', function() {
    it('should default to setting an empty relation chain', function() {

    });
    it('should populate the relation chain of a model that exists as the relation of another model', function() {

    });
  });
  describe('roleDeterminer', function() {
    it('should default to not setting a roleDeterminer method', function() {

    });
    it('should fail to serialize a model lacking a roleDeterminer method', function() {

    });
  });
  describe('rolesToVisibleFields', function() {
    it('should default to not setting a rolesToVisibleFields dictionary', function() {

    });
    it('should fail to serialize a model lacking a rolesToVisibleFields dictionary', function() {

    });
  });
  describe('constructor', function() {
    it('should allow setting the accessor via an option passed to .forge()', function() {

    });
  });
  describe('fetchAll', function() {
    it('should set the accessor on all models in a collection fetched via fetchAll', function() {

    });
  });
  describe('toJSON', function() {
    it('should return a promise', function() {

    });
    it('should reject a visibleFields that is not an array', function() {

    });
    it('should resolve a model with no visible fields as undefined', function() {

    });
    it('should remove undefineds from a relation that is an array', function() {

    });
    describe('evaluator', function() {
      it('should require a truthy evaluator to be a function', function() {

      });
      it('should invoke evaluator with tableName, _accessedAsRelationChain, and model id as default arguments', function() {

      });
      it('should return a promise so that evaluator methods may do async work if they want to', function() {

      });
      it('should support providing a custom function for generating the arguments passed to the evaluator function', function() {

      });
    });
    it('should convert empty object to null, to handle Bookshelf bug that can cause a model to be completely empty', function() {
      // Cf. https://github.com/tgriesser/bookshelf/issues/753
    });
    describe('ensureRelationsLoaded', function() {
      it('should allow ensureRelationsLoaded to be falsy', function() {

      });
      it('should require truthy ensureRelationsLoaded to be an object', function() {

      });
      it('should handle as normally a table name that is not present in ensureRelationsLoaded', function() {

      });
      it('should support ensureRelationsLoaded[tableName] being an array', function() {

      });
      it('should require an evaluator function if ensureRelationsLoaded[tableName] is an object', function() {

      });
      it('should support ensureRelationsLoaded[tableName] being an object and use the designation returned by the evaluator function', function() {

      });
      it('should require that ensureRelationsLoaded[tableName][designation] be an array', function() {

      });
      it('should support custom handling of relation names to be loaded', function() {

      });
      it('should respect a `true` value of ensureRelationsVisibleAndInvisible when ensuring relations loaded', function() {

      });
      it('should respect a `false` value of ensureRelationsVisibleAndInvisible when ensuring relations loaded', function() {

      });
      it('should log about loading unnecessary relations if not in production env, when options.ensureRelationsVisibleAndInvisible is true', function() {

      });
      it('should log about loading unnecessary relations if not in production env, when options.ensureRelationsVisibleAndInvisible is false', function() {

      });
    });
    describe('contextSpecificVisibleFields', function() {
      it('should allow contextSpecificVisibleFields to be falsy', function() {

      });
      it('should require truthy contextSpecificVisibleFields to be an object', function() {

      });
      it('should handle as normally a table name that is not present in contextSpecificVisibleFields', function() {

      });
      it('should support contextSpecificVisibleFields[tableName] being an array', function() {

      });
      it('should require an evaluator function if contextSpecificVisibleFields[tableName] is an object', function() {

      });
      it('should support contextSpecificVisibleFields[tableName] being an object and use the designation returned by the evaluator function', function() {

      });
      it('should require contextSpecificVisibleFields[tableName][designation] to be an array', function() {

      });
    });
    it('should calculate visible fields as the intersection of the role visible fields and the context-specific visible fields', function() {

    });
    it('should remove relations from the model that do not need to be serialized, which can be important to prevent infinite looping', function() {

    });
    it('should successfully resolve promise with the serialized payload', function() {

    });
    it('should remove undefineds and empty objects from arrays in result', function() {
      // TODO Is the removal of empty objects necessary here, or is it superfluous
      // because empty objects would have already been converted to undefined (or perhaps null)?
    });
    it('should convert an empty object value of a result property to null', function() {
      // Cf. https://github.com/tgriesser/bookshelf/issues/753
    });
  });
  describe('serialize', function() {
    it('should wait for all promises in an attribute whose value is an array to be resolved', function() {
      // TODO Is this necessary? We already do similar promisification for collections.
    });
    it('should remove undefined and empty objects from arrays', function() {
      // TODO Is this necessary? We already do this to the result of toJSON.
    });
    it('should respect shallow: true option', function() {

    });
    it('should respect omitPivot: true option', function() {

    });
  });
  describe('related', function() {
    it('should transfer the accessor on the model to the relation loaded via .related()', function() {

    });
    it('should transfer _accessedAsRelationChain to the related model and append to it the relation name', function() {
      // TODO Be sure to check that the original value of _accessedAsRelationChain is not mutated.
    });
  });
});

describe('Collection', function() {
  describe('serialize', function() {
    it('should wait for all promises in the collection to resolve', function() {

    });
    it('should remove undefineds from a serialized collection', function() {

    });
  });
  it('should successfully serialize a collection', function() {

  });
});
