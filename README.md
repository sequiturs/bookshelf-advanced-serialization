# bookshelf-advanced-serialization [![Build Status](https://travis-ci.org/sequiturs/bookshelf-advanced-serialization.svg?branch=master)](https://travis-ci.org/sequiturs/bookshelf-advanced-serialization) [![Coverage Status](https://coveralls.io/repos/github/sequiturs/bookshelf-advanced-serialization/badge.svg?branch=master)](https://coveralls.io/github/sequiturs/bookshelf-advanced-serialization?branch=master) [![npm version](https://img.shields.io/npm/v/bookshelf-advanced-serialization.svg?style=flat)](https://www.npmjs.com/package/bookshelf-advanced-serialization)

## Description

This module is a plugin for [Bookshelf.js](https://github.com/tgriesser/bookshelf), supporting three types of custom serialization behavior:

1. serializing according to **access permissions**,
2. serializing according to the **application context** in which serialization is performed, and
3. serializing after ensuring that particular **relations have been loaded** on the model / collection.

Together, these features ensure that one call to `toJSON` can yield an arbitrarily complex serialization result: any combination of a model's properties (i.e. in Bookshelf terminology, attributes and relations), the properties of its relations, and so on indefinitely. In other words, this module supports **recursive serialization** (and it does so in a way that allows infinite looping / cycling to be easily prevented if that would otherwise be a danger). This means the module excels at supporting hierarchical data models.

## Philosophy

This module was designed to support serializing models which represent the resources of the Sequiturs REST API. It is thus well-suited to the use case of using Bookshelf to power a REST API.

One important aspect of the REST API use case is customizing the serialization result according to the access permissions of the client. It is crucial that no data be leaked to a client who should not see it. For this reason, this module exclusively implements a **whitelisting** approach to serialization, and does not support blacklisting. Only properties that have been explicitly allowed to be serialized--whitelisted--will be returned by `toJSON`. This makes leaking data more difficult. This is good.

This **strict approach to data security** is reflected in another aspect of implementation: the module assumes that when a model has no visible properties, the serialized result should not even indicate to the client that the model exists! In practice, this means that (1) models with no visible properties are serialized to `undefined` rather than `{}`, and (2) these `undefined` values are removed from arrays. This is useful in the following situation, for instance: suppose there is a collection that contains public items, which the client should be able to see, and private items, which the client should not be able to see. The current implementation ensures that the client will not receive any indication how many private items exist or in what order they appear in the collection. In future, this behavior could be made optional, if that is desired.

## How to use

### Overview

The serialization result returned by `toJSON` is determined by:

1. evaluating the access permissions of the recipient to determine the maximum extent of the recipient's visibility into a model,
2. optionally removing properties that it's not necessary to return given the application context in which serialization is being performed,
3. optionally loading relations on the model (or on the model's relations, recursively to any depth) before serializing.

1\. is accomplished using three parts:
- an `accessor` value set on a model instance,
- a `roleDeterminer` method set on the model class, and
- a `rolesToVisibleFields` object set on the model class.

`accessor` represents who is accessing the model; this is the recipient of the serialization result. `roleDeterminer` is a function for determining the role of the `accessor` in relation to the model instance. When you call `toJSON`, `roleDeterminer` is invoked, with the `accessor` passed as an argument. `rolesToVisibleFields` is an object that maps a role to a list of properties that should be visible to someone with that role.

2\. is accomplished using two parts:
- a `contextSpecificVisibleFields` object provided on the `options` object passed to `toJSON`
- an optional `evaluator` function also provided on the `options` object

`contextSpecificVisibleFields` indexes lists of the properties of a model that should be visible in light of the application context. These lists are indexed first by models' `tableName`, which allows for easily specifying context-specific visible properties for all models of a certain type. (We use `tableName` because this is the only identifier Bookshelf provides for identifying a model's type.) If you want fine-grained control over designating context beyond simply by model type, you can provide an `evaluator` function, which is invoked when you call `toJSON`, and which by default is passed the model's `tableName`, [`_accessedAsRelationChain`](#_accessedAsRelationChain), and `id` properties as arguments. (You can override this default behavior and pass custom arguments to `evaluator`, by passing your own `getEvaluatorArguments` function when registering this plugin.) The designation returned by `evaluator` will be used to lookup the list of context-specific visible properties, inside `contextSpecificVisibleFields[tableName]`.

3\. is accomplished using two parts:
- an `ensureRelationsLoaded` object provided on the `options` object passed to `toJSON`
- an optional `evaluator` function also provided on the `options` object. This is the same `evaluator` as in 2\.

`ensureRelationsLoaded` works analogously to `contextSpecificVisibleFields`, except the lists contain the names of relations that should be loaded on the model prior to serialization, rather than context-specific visible properties.

### Installation

```JavaScript
'use strict';

var advancedSerialization = require('bookshelf-advanced-serialization');

var knex = require('knex')({ ... });
var bookshelf = require('bookshelf')(knex);

bookshelf.plugin(advancedSerialization());

module.exports = bookshelf;
```

### API

#### `Model`

##### `accessor`

TODO

##### <a name="\_accessedAsRelationChain"></a>`_accessedAsRelationChain`

TODO

##### `forge`

TODO
What about `constructor`?

##### `roleDeterminer(accessor)` - required

TODO

This function may return a promise resolving to the role. This supports asynchronously determining the role.

##### `rolesToVisibleFields` - required

TODO

This should be an object which maps a role to the list of properties that should be visible to someone with that role.

The role's visibleFields represent the list of properties that may possibly be returned; the final result is a subset.

##### `toJSON(options)`

TODO

Note that this method may mutate the model. Specifically, it will add relations according to `ensureRelationsLoaded`, and it will remove relations not present in the model's visible fields.

###### `contextSpecificVisibleFields`

TODO

###### `ensureRelationsLoaded`

TODO

###### `evaluator`

TODO

The evaluator is especially useful for preventing infinite looping in serialization. See [TODO](TODO) for an example.

### Examples

See [`examples/rest-api`](https://github.com/sequiturs/bookshelf-advanced-serialization/tree/master/examples/rest-api).

Within [`examples/rest-api/server.js`](https://github.com/sequiturs/bookshelf-advanced-serialization/blob/master/examples/rest-api/server.js), there are examples of the different ways you can use this module to control serialization behavior:

- Using access permissions but not application context
    - See route handling for `/users/:username`.
- Using access permissions and application context
    - using `evaluator`'s context designations with `contextSpecificVisibleFields`
        - See route handling for `/comments/:id`.
    - using only table names, not `evaluator`'s context designations, with `contextSpecificVisibleFields`
        - See route handling for `/comments/:id`, specifically the `users` table name.
    - using custom arguments in the `evaluator` function
        - See route handling for `/comments/:id`.
    - using the default `relationChain` argument to `evaluator`
        - TODO
- After ensuring certain relations have been loaded
    - using `evaluator`'s context designations with `ensureRelationsLoaded`
        - See route handling for `/comments/:id`.
    - using only table names, not `evaluator`'s context designations, with `ensureRelationsLoaded`
        - See route handling for `/users/:username`.
    - using custom arguments in the `evaluator` function
        - See route handling for `/comments/:id`.
    - using the default `relationChain` argument to `evaluator`
        - TODO

## License

See [`LICENSE.md`](https://github.com/sequiturs/bookshelf-advanced-serialization/blob/master/LICENSE.md).
