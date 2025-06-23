/**
 * GraphQL Helper Utilities
 * 
 * This utility module provides reusable GraphQL query and mutation builders
 * for Shopify's Admin API. It helps maintain consistency and reduces code duplication
 * across the application.
 */

class GraphQLHelper {
  
  /**
   * Build a company search query
   * 
   * @param {string} searchTerm - Search term for company lookup
   * @param {number} limit - Maximum number of results to return
   * @returns {Object} GraphQL query object with variables
   */
  static buildCompanySearchQuery(searchTerm, limit = 1) {
    const query = `
      query findCompany($query: String!, $first: Int!) {
        companies(first: $first, query: $query) {
          edges {
            node {
              id
              name
              externalId
              note
              defaultRole {
                id
                name
              }
              contactsCount {
                count
              }
              createdAt
              updatedAt
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;

    return {
      query,
      variables: {
        query: `name:"${searchTerm}"`,
        first: limit
      }
    };
  }

  /**
   * Build a customer search query
   * 
   * @param {string} email - Customer email to search for
   * @param {number} limit - Maximum number of results to return
   * @returns {Object} GraphQL query object with variables
   */
  static buildCustomerSearchQuery(email, limit = 1) {
    const query = `
      query findCustomer($query: String!, $first: Int!) {
        customers(first: $first, query: $query) {
          edges {
            node {
              id
              email
              firstName
              lastName
              displayName
              tags
              note
              createdAt
              updatedAt
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;

    return {
      query,
      variables: {
        query: `email:"${email}"`,
        first: limit
      }
    };
  }

  /**
   * Build a company creation mutation
   * 
   * @param {Object} companyData - Company data for creation
   * @returns {Object} GraphQL mutation object with variables
   */
  static buildCompanyCreateMutation(companyData) {
    const mutation = `
      mutation companyCreate($input: CompanyCreateInput!) {
        companyCreate(input: $input) {
          company {
            id
            name
            externalId
            note
            defaultRole {
              id
              name
            }
            contactsCount {
              count
            }
            createdAt
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    // Build the input object
    const input = {
      company: {
        name: companyData.companyName,
        note: companyData.note || `Created via sync from Google Sheets on ${new Date().toISOString()}`,
        externalId: companyData.externalId || `sheet-sync-${Date.now()}`
      }
    };

    // Note: Company address will be handled separately after company creation

    return {
      mutation,
      variables: { input }
    };
  }

  /**
   * Build a customer creation mutation
   * 
   * @param {Object} customerData - Customer data for creation
   * @returns {Object} GraphQL mutation object with variables
   */
  static buildCustomerCreateMutation(customerData) {
    const mutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
            firstName
            lastName
            displayName
            tags
            note
            createdAt
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const input = {
      email: customerData.email,
      firstName: customerData.firstName,
      lastName: customerData.lastName,
      note: customerData.note || `Created via sync from Google Sheets on ${new Date().toISOString()}`,
      tags: customerData.tags || ['sheet-sync']
    };

    // Add phone if provided
    if (customerData.phone) {
      input.phone = customerData.phone;
    }

    return {
      mutation,
      variables: { input }
    };
  }

  /**
   * Build a company contact creation mutation
   * 
   * @param {string} companyId - Shopify company ID
   * @param {string} customerId - Shopify customer ID
   * @param {string} roleId - Company role ID (optional)
   * @returns {Object} GraphQL mutation object with variables
   */
  static buildCompanyContactCreateMutation(companyId, customerId, roleId = null) {
    const mutation = `
      mutation companyContactCreate($companyId: ID!, $input: CompanyContactInput!) {
        companyContactCreate(companyId: $companyId, input: $input) {
          companyContact {
            id
            customer {
              id
              email
              firstName
              lastName
            }
            role {
              id
              name
            }
            isMainContact
            createdAt
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const input = {
      customerId
    };

    // Add role assignment if provided
    if (roleId) {
      input.roleAssignment = {
        companyContactRoleId: roleId
      };
    }

    return {
      mutation,
      variables: {
        companyId,
        input
      }
    };
  }

  /**
   * Build a query to get company details with roles
   * 
   * @param {string} companyId - Shopify company ID
   * @returns {Object} GraphQL query object with variables
   */
  static buildCompanyDetailsQuery(companyId) {
    const query = `
      query getCompany($id: ID!) {
        company(id: $id) {
          id
          name
          externalId
          note
          defaultRole {
            id
            name
          }
          contactRoles(first: 20) {
            edges {
              node {
                id
                name
              }
            }
          }
          contactsCount {
            count
          }
          createdAt
          updatedAt
        }
      }
    `;

    return {
      query,
      variables: { id: companyId }
    };
  }

  /**
   * Build a query to get multiple companies with pagination
   * 
   * @param {number} limit - Number of companies to fetch
   * @param {string} cursor - Pagination cursor (optional)
   * @returns {Object} GraphQL query object with variables
   */
  static buildCompaniesListQuery(limit = 10, cursor = null) {
    const query = `
      query getCompanies($first: Int!, $after: String) {
        companies(first: $first, after: $after) {
          edges {
            node {
              id
              name
              externalId
              contactsCount {
                count
              }
              createdAt
            }
            cursor
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    `;

    const variables = { first: limit };
    if (cursor) {
      variables.after = cursor;
    }

    return {
      query,
      variables
    };
  }

  /**
   * Validate GraphQL response and extract errors
   * 
   * @param {Object} response - GraphQL response object
   * @returns {Object} Validation result with success flag and errors
   */
  static validateResponse(response) {
    const result = {
      success: true,
      errors: [],
      data: null
    };

    // Check for top-level GraphQL errors
    if (response.errors && response.errors.length > 0) {
      result.success = false;
      result.errors = response.errors.map(error => ({
        type: 'graphql_error',
        message: error.message,
        locations: error.locations,
        path: error.path
      }));
      return result;
    }

    // Check for user errors in mutation responses
    if (response.data) {
      result.data = response.data;
      
      // Check each field in the response for userErrors
      Object.keys(response.data).forEach(key => {
        const field = response.data[key];
        if (field && field.userErrors && field.userErrors.length > 0) {
          result.success = false;
          result.errors.push(...field.userErrors.map(error => ({
            type: 'user_error',
            field: error.field,
            message: error.message,
            code: error.code
          })));
        }
      });
    }

    return result;
  }

  /**
   * Format error messages for logging
   * 
   * @param {Array} errors - Array of error objects
   * @returns {string} Formatted error message
   */
  static formatErrors(errors) {
    if (!errors || errors.length === 0) {
      return 'No errors';
    }

    return errors.map(error => {
      let message = `${error.type}: ${error.message}`;
      if (error.field) {
        message += ` (field: ${error.field})`;
      }
      if (error.code) {
        message += ` (code: ${error.code})`;
      }
      return message;
    }).join('; ');
  }
}

module.exports = GraphQLHelper; 