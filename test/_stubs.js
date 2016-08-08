'use strict';

module.exports = {
  users: {
    elephant1: {
      id: '3fe94198-7b32-44ee-abdd-04104b902c51',
      username: 'elephant1',
      email: 'elephant1@example.com',
      created_at: '2016-01-03T04:07:51.690Z'
    },
    antelope99: {
      id: '3d33e941-e23e-41fa-8807-03e87ce7baa8',
      username: 'antelope99',
      email: 'antelope99@example.com',
      created_at: '2016-02-03T04:07:51.690Z'
    }
  },
  groups: {
    slouchyGauchos: {
      id: '0f91fab2-48b5-4396-9b75-632f99da02c2',
      name: 'Slouchy gauchos'
    }
  },
  comments: [
    {
      id: '8dc1464d-8c32-448d-a81d-ff161077d781',
      author_id: '3fe94198-7b32-44ee-abdd-04104b902c51',
      content: 'Hello, World!'
    }
  ]
};
