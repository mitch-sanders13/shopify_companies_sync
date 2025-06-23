/**
 * Shopify Service
 * 
 * This service handles all interactions with Shopify's GraphQL Admin API
 * to create companies, customers, locations, and establish their relationships.
 * Enhanced flow: Company → Customer → Location → Assignment
 * 
 * Key Features:
 * - Creates/finds companies using external IDs from Google Sheets
 * - Creates/finds customers and links them as company contacts
 * - Creates/finds company locations linked to companies
 * - Assigns customers to specific locations using company contact roles
 * - Handles duplicate prevention and error recovery
 * 
 * Location Assignment Process:
 * 1. Find/create company contact role for the assignment
 * 2. Create role assignment linking contact to location
 * 3. Handle existing assignments gracefully
 * 
 * Requires Shopify Plus for B2B company features.
 */

const axios = require('axios');
const { buildClientSchema, getIntrospectionQuery } = require('graphql');

class ShopifyService {
  constructor() {
    // Shopify API configuration
    this.apiUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`;
    this.headers = {
      'Content-Type': 'application/json',
              'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
    };
  }

  /**
   * Execute a GraphQL query/mutation against Shopify's Admin API
   * @param {string} query - The GraphQL query or mutation
   * @param {Object} variables - Variables for the query/mutation
   * @returns {Promise<Object>} The response data
   */
  async executeQuery(query, variables = {}) {
    try {
      console.log('📡 Executing Shopify GraphQL query...');
      
      const response = await axios.post(this.apiUrl, {
        query,
        variables
      }, {
        headers: this.headers
      });

      if (response.data.errors) {
        console.error('❌ GraphQL errors:', response.data.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } catch (error) {
      console.error('❌ Shopify API error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Find a company by external ID (Company ID from spreadsheet)
   * @param {string} externalId - The external ID to search for
   * @returns {Promise<Object|null>} Company object or null if not found
   */
  async findCompanyByExternalId(externalId) {
    // Validate external ID before searching
    if (!externalId || typeof externalId !== 'string' || externalId.trim() === '') {
      console.error('❌ Invalid external ID provided for company search:', externalId);
      throw new Error('External ID cannot be empty or invalid');
    }

    const trimmedExternalId = externalId.trim();
    console.log(`🔍 Searching for company with external ID: "${trimmedExternalId}"`);

    const query = `
      query findCompany($query: String!) {
        companies(first: 1, query: $query) {
          edges {
            node {
              id
              name
              externalId
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    try {
      const data = await this.executeQuery(query, {
        query: `external_id:${trimmedExternalId}`
      });

      const companies = data.companies.edges;
      if (companies.length > 0) {
        console.log(`✅ Found existing company: "${companies[0].node.name}" (ID: ${companies[0].node.externalId})`);
        return companies[0].node;
      } else {
        console.log(`📭 No company found with external ID: "${trimmedExternalId}"`);
        return null;
      }
    } catch (error) {
      console.error('❌ Error finding company:', error);
      throw error;
    }
  }

  /**
   * Create a new company in Shopify
   * @param {Object} companyData - Company information from spreadsheet
   * @returns {Promise<Object>} Created company object
   */
  async createCompany(companyData) {
    const mutation = `
      mutation companyCreate($input: CompanyCreateInput!) {
        companyCreate(input: $input) {
          company {
            id
            name
            externalId
            createdAt
            updatedAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      company: {
        name: companyData.companyName,
        externalId: companyData.companyId,
        note: `Created via sync from Google Sheets\nCompany ID: ${companyData.companyId}\nSync Date: ${new Date().toISOString()}`
      }
    };

    try {
      console.log(`🏢 Creating company: ${companyData.companyName} (ID: ${companyData.companyId})`);
      
      const data = await this.executeQuery(mutation, { input });
      
      if (data.companyCreate.userErrors?.length > 0) {
        throw new Error(`Company creation errors: ${JSON.stringify(data.companyCreate.userErrors)}`);
      }

      console.log('✅ Company created successfully');
      return data.companyCreate.company;
    } catch (error) {
      console.error('❌ Error creating company:', error);
      throw error;
    }
  }

  /**
   * Find a customer by email address
   * @param {string} email - Customer email address
   * @returns {Promise<Object|null>} Customer object or null if not found
   */
  async findCustomerByEmail(email) {
    const query = `
      query findCustomer($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              email
              firstName
              lastName
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    try {
      const data = await this.executeQuery(query, {
        query: `email:${email}`
      });

      const customers = data.customers.edges;
      return customers.length > 0 ? customers[0].node : null;
    } catch (error) {
      console.error('❌ Error finding customer:', error);
      throw error;
    }
  }

  /**
   * Create a new customer in Shopify
   * @param {Object} customerData - Customer information from spreadsheet
   * @returns {Promise<Object>} Created customer object
   */
  async createCustomer(customerData) {
    const mutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
            firstName
            lastName
            createdAt
            updatedAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      email: customerData.customerEmail,
      firstName: customerData.customerFirstName,
      lastName: customerData.customerLastName,
      note: `Created via sync from Google Sheets\nCompany: ${customerData.companyName}\nLocation: ${customerData.locationId}\nRole: ${customerData.customerRole}\nSync Date: ${new Date().toISOString()}`,
      tags: [`company:${customerData.companyId}`, `location:${customerData.locationId}`, `role:${customerData.customerRole}`]
    };

    try {
      console.log(`👤 Creating customer: ${customerData.customerEmail}`);
      
      const data = await this.executeQuery(mutation, { input });
      
      if (data.customerCreate.userErrors?.length > 0) {
        throw new Error(`Customer creation errors: ${JSON.stringify(data.customerCreate.userErrors)}`);
      }

      console.log('✅ Customer created successfully');
      return data.customerCreate.customer;
    } catch (error) {
      console.error('❌ Error creating customer:', error);
      throw error;
    }
  }

  /**
   * Check if a customer is already associated with a company
   * @param {string} companyId - The Shopify company ID
   * @param {string} customerId - The Shopify customer ID
   * @returns {Promise<Object|null>} Existing company contact or null
   */
  async findExistingCompanyContact(companyId, customerId) {
    const query = `
      query findCompanyContact($companyId: ID!) {
        company(id: $companyId) {
          contacts(first: 250) {
            edges {
              node {
                id
                customer {
                  id
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.executeQuery(query, { companyId });
      
      if (!data.company || !data.company.contacts) {
        return null;
      }

      const existingContact = data.company.contacts.edges.find(
        edge => edge.node.customer.id === customerId
      );

      return existingContact ? existingContact.node : null;
    } catch (error) {
      console.error('❌ Error checking existing company contact:', error);
      return null;
    }
  }

  /**
   * Associate an existing customer with a company as a company contact
   * @param {string} companyId - The Shopify company ID
   * @param {string} customerId - The Shopify customer ID
   * @returns {Promise<Object>} Created company contact object
   */
  async associateCustomerWithCompany(companyId, customerId) {
    const mutation = `
      mutation companyAssignCustomerAsContact($companyId: ID!, $customerId: ID!) {
        companyAssignCustomerAsContact(companyId: $companyId, customerId: $customerId) {
          companyContact {
            id
            customer {
              id
              email
              firstName
              lastName
            }
            createdAt
            updatedAt
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    try {
      console.log(`🔗 Associating existing customer ${customerId} with company ${companyId}`);
      
      const data = await this.executeQuery(mutation, { companyId, customerId });
      
      if (data.companyAssignCustomerAsContact.userErrors?.length > 0) {
        throw new Error(`Customer association errors: ${JSON.stringify(data.companyAssignCustomerAsContact.userErrors)}`);
      }

      console.log('✅ Customer associated with company successfully');
      return data.companyAssignCustomerAsContact.companyContact;
    } catch (error) {
      console.error('❌ Error associating customer with company:', error);
      throw error;
    }
  }

  /**
   * Create a company contact (this also creates the associated customer)
   * @param {string} companyId - The Shopify company ID
   * @param {Object} customerData - Customer information
   * @returns {Promise<Object>} Created company contact object
   */
  async createCompanyContact(companyId, customerData) {
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
            createdAt
            updatedAt
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
      email: customerData.customerEmail,
      firstName: customerData.customerFirstName,
      lastName: customerData.customerLastName,
      locale: 'en'
    };

    try {
      console.log(`🔗 Creating company contact for: ${customerData.customerEmail}`);
      
      const data = await this.executeQuery(mutation, { companyId, input });
      
      if (data.companyContactCreate.userErrors?.length > 0) {
        throw new Error(`Company contact creation errors: ${JSON.stringify(data.companyContactCreate.userErrors)}`);
      }

      console.log('✅ Company contact created successfully');
      return data.companyContactCreate.companyContact;
    } catch (error) {
      console.error('❌ Error creating company contact:', error);
      throw error;
    }
  }

  /**
   * Find a company location by external ID (Location ID from spreadsheet)
   * @param {string} companyId - The Shopify company ID
   * @param {string} externalId - The external ID to search for
   * @returns {Promise<Object|null>} Location object or null if not found
   */
  async findLocationByExternalId(companyId, externalId) {
    const query = `
      query findLocation($companyId: ID!) {
        company(id: $companyId) {
          locations(first: 50) {
            edges {
              node {
                id
                name
                externalId
                shippingAddress {
                  address1
                  city
                  province
                  zip
                  country
                }
                createdAt
                updatedAt
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.executeQuery(query, { companyId });
      
      if (!data.company) {
        return null;
      }

      const locations = data.company.locations.edges;
      const location = locations.find(edge => edge.node.externalId === externalId);
      return location ? location.node : null;
    } catch (error) {
      console.error('❌ Error finding location:', error);
      throw error;
    }
  }

  /**
   * Create a new company location in Shopify
   * @param {string} companyId - The Shopify company ID
   * @param {Object} locationData - Location information from spreadsheet
   * @returns {Promise<Object>} Created location object
   */
  async createCompanyLocation(companyId, locationData) {
    const mutation = `
      mutation companyLocationCreate($companyId: ID!, $input: CompanyLocationInput!) {
        companyLocationCreate(companyId: $companyId, input: $input) {
          companyLocation {
            id
            name
            externalId
            shippingAddress {
              address1
              city
              province
              zip
              country
            }
            createdAt
            updatedAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      name: `${locationData.companyName} - ${locationData.address}`,
      externalId: locationData.locationId,
      note: `Created via sync from Google Sheets\nLocation ID: ${locationData.locationId}\nSync Date: ${new Date().toISOString()}`,
      shippingAddress: {
        address1: locationData.address,
        city: locationData.city,
        zoneCode: locationData.state,
        zip: locationData.zip,
        countryCode: 'US' // Default to US, can be made configurable
      },
      billingSameAsShipping: true
    };

    try {
      console.log(`📍 Creating location: ${input.name} (ID: ${locationData.locationId})`);
      
      const data = await this.executeQuery(mutation, { companyId, input });
      
      if (data.companyLocationCreate.userErrors?.length > 0) {
        throw new Error(`Location creation errors: ${JSON.stringify(data.companyLocationCreate.userErrors)}`);
      }

      console.log('✅ Location created successfully');
      return data.companyLocationCreate.companyLocation;
    } catch (error) {
      console.error('❌ Error creating location:', error);
      throw error;
    }
  }

  /**
   * Check if a customer is already assigned to a specific company location
   * @param {string} companyContactId - The company contact ID
   * @param {string} locationId - The location ID
   * @returns {Promise<boolean>} True if customer is assigned to location
   */
  async isCustomerAssignedToLocation(companyContactId, locationId) {
    const query = `
      query checkLocationAssignment($companyContactId: ID!) {
        companyContact(id: $companyContactId) {
          roleAssignments(first: 50) {
            edges {
              node {
                id
                companyLocation {
                  id
                  name
                }
                role {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `;

    try {
      console.log(`🔍 Checking if customer is already assigned to location...`);
      
      const data = await this.executeQuery(query, { companyContactId });
      
      if (!data.companyContact) {
        console.log(`⚠️  Company contact not found: ${companyContactId}`);
        return false;
      }

      const assignments = data.companyContact.roleAssignments.edges;
      const isAssigned = assignments.some(edge => edge.node.companyLocation?.id === locationId);
      
      if (isAssigned) {
        const assignment = assignments.find(edge => edge.node.companyLocation?.id === locationId);
        console.log(`✅ Customer is already assigned to location: ${assignment.node.companyLocation.name}`);
      } else {
        console.log(`📭 Customer is not yet assigned to this location`);
      }
      
      return isAssigned;
    } catch (error) {
      console.error('❌ Error checking location assignment:', error);
      // Return false on error to allow assignment attempt
      return false;
    }
  }

  /**
   * Get or create a company contact role for location assignment
   * @param {string} companyId - The company ID
   * @param {string} roleName - The role name (defaults to 'Location Member')
   * @returns {Promise<Object>} Company contact role object
   */
  async getOrCreateCompanyContactRole(companyId, roleName = 'Location Member') {
    // First, try to find an existing role
    const findRoleQuery = `
      query findCompanyContactRoles($companyId: ID!) {
        company(id: $companyId) {
          contactRoles(first: 10) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.executeQuery(findRoleQuery, { companyId });
      
      if (data.company && data.company.contactRoles.edges.length > 0) {
        // Use the first available role or find one matching our role name
        const existingRole = data.company.contactRoles.edges.find(edge => 
          edge.node.name.toLowerCase().includes('member') || 
          edge.node.name.toLowerCase().includes('location')
        );
        
        if (existingRole) {
          console.log(`🎭 Using existing company contact role: ${existingRole.node.name}`);
          return existingRole.node;
        } else {
          // Use the first available role if no matching role found
          console.log(`🎭 Using first available company contact role: ${data.company.contactRoles.edges[0].node.name}`);
          return data.company.contactRoles.edges[0].node;
        }
      }

      // If no roles exist, create a new one
      console.log(`🎭 Creating new company contact role: ${roleName}`);
      return await this.createCompanyContactRole(companyId, roleName);
      
    } catch (error) {
      console.error('❌ Error finding company contact role:', error);
      throw error;
    }
  }

  /**
   * Create a new company contact role
   * @param {string} companyId - The company ID
   * @param {string} roleName - The role name
   * @returns {Promise<Object>} Created company contact role
   */
  async createCompanyContactRole(companyId, roleName) {
    const mutation = `
      mutation companyContactRoleCreate($companyId: ID!, $input: CompanyContactRoleInput!) {
        companyContactRoleCreate(companyId: $companyId, input: $input) {
          companyContactRole {
            id
            name
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      name: roleName,
      note: `Created via sync for location assignments\nSync Date: ${new Date().toISOString()}`
    };

    try {
      const data = await this.executeQuery(mutation, { companyId, input });
      
      if (data.companyContactRoleCreate.userErrors?.length > 0) {
        throw new Error(`Role creation errors: ${JSON.stringify(data.companyContactRoleCreate.userErrors)}`);
      }

      console.log(`✅ Company contact role created: ${roleName}`);
      return data.companyContactRoleCreate.companyContactRole;
    } catch (error) {
      console.error('❌ Error creating company contact role:', error);
      throw error;
    }
  }

  /**
   * Assign a company contact to a specific location with a role
   * @param {string} companyContactId - The company contact ID
   * @param {string} locationId - The location ID to assign to
   * @param {string} roleName - The role name for the assignment
   * @returns {Promise<Object>} Assignment result
   */
  async assignCustomerToLocation(companyContactId, locationId, roleName = 'MEMBER') {
    try {
      // First, get the company ID from the contact to find/create a role
      const getContactQuery = `
        query getCompanyContact($companyContactId: ID!) {
          companyContact(id: $companyContactId) {
            company {
              id
            }
          }
        }
      `;

      const contactData = await this.executeQuery(getContactQuery, { companyContactId });
      
      if (!contactData.companyContact?.company?.id) {
        throw new Error('Could not find company for the contact');
      }

      const companyId = contactData.companyContact.company.id;

      // Get or create a company contact role
      const contactRole = await this.getOrCreateCompanyContactRole(companyId, 'Location Member');

      // Now create the role assignment using the correct mutation
      const assignmentMutation = `
        mutation companyContactAssignRole($companyContactId: ID!, $companyContactRoleId: ID!, $companyLocationId: ID!) {
          companyContactAssignRole(
            companyContactId: $companyContactId, 
            companyContactRoleId: $companyContactRoleId, 
            companyLocationId: $companyLocationId
          ) {
            companyContactRoleAssignment {
              id
              companyLocation {
                id
                name
              }
              role {
                id
                name
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      console.log(`🔗 Assigning customer to location with role: ${contactRole.name}`);
      
      const assignmentData = await this.executeQuery(assignmentMutation, { 
        companyContactId, 
        companyContactRoleId: contactRole.id,
        companyLocationId: locationId
      });
      
      if (assignmentData.companyContactAssignRole.userErrors?.length > 0) {
        const errors = assignmentData.companyContactAssignRole.userErrors;
        
        // Check if the error is about existing assignment
        const duplicateError = errors.find(error => 
          error.message.toLowerCase().includes('already exists') ||
          error.message.toLowerCase().includes('duplicate') ||
          error.message.toLowerCase().includes('already assigned')
        );
        
        if (duplicateError) {
          console.log(`ℹ️  Customer is already assigned to this location: ${duplicateError.message}`);
          return null;
        } else {
          throw new Error(`Role assignment errors: ${JSON.stringify(errors)}`);
        }
      }

      const assignment = assignmentData.companyContactAssignRole.companyContactRoleAssignment;
      console.log(`✅ Customer successfully assigned to location: ${assignment.companyLocation.name}`);
      
      return assignment;
      
    } catch (error) {
      console.error('❌ Error assigning customer to location:', error);
      throw error;
    }
  }

  /**
   * Get or create a company based on Company ID
   * @param {Object} data - Row data from spreadsheet
   * @returns {Promise<Object>} Company object
   */
  async getOrCreateCompany(data) {
    // First try to find existing company
    let company = await this.findCompanyByExternalId(data.companyId);
    
    if (!company) {
      // Create new company if not found
      company = await this.createCompany(data);
    } else {
      console.log(`🏢 Found existing company: ${company.name} (ID: ${company.externalId})`);
    }
    
    return company;
  }

  /**
   * Get or create a customer and link to company
   * @param {string} companyId - The Shopify company ID
   * @param {Object} data - Row data from spreadsheet
   * @returns {Promise<Object>} Customer and contact objects
   */
  async getOrCreateCustomerAndContact(companyId, data) {
    try {
      // First try to find existing customer
      let customer = await this.findCustomerByEmail(data.customerEmail);
      let contact;
      
      if (customer) {
        console.log(`👤 Found existing customer: ${customer.email}`);
        
        // Check if customer is already associated with this company
        contact = await this.findExistingCompanyContact(companyId, customer.id);
        
        if (contact) {
          console.log(`🔗 Customer already associated with company`);
        } else {
          // Try to associate existing customer with company
          try {
            contact = await this.associateCustomerWithCompany(companyId, customer.id);
          } catch (error) {
            if (error.message.includes('Customer is already associated with a company contact')) {
              console.log(`⚠️  Customer ${customer.email} is already associated with another company. Skipping association.`);
              console.log(`ℹ️  To resolve this, you may need to manually transfer the customer or use a different email.`);
              // Return a minimal contact object to allow processing to continue
              contact = {
                id: `existing-${customer.id}`,
                customer: customer
              };
            } else {
              throw error; // Re-throw other errors
            }
          }
        }
      } else {
        console.log(`👤 Creating new customer: ${data.customerEmail}`);
        
        // Create both customer and company contact together
        contact = await this.createCompanyContact(companyId, data);
        customer = contact.customer;
      }
      
      return { customer, contact };
    } catch (error) {
      console.error('❌ Error in customer/contact process:', error);
      throw error;
    }
  }

  /**
   * Get or create a company location based on Location ID
   * @param {string} companyId - The Shopify company ID
   * @param {Object} data - Row data from spreadsheet
   * @returns {Promise<Object>} Location object
   */
  async getOrCreateLocation(companyId, data) {
    // First try to find existing location
    let location = await this.findLocationByExternalId(companyId, data.locationId);
    
    if (!location) {
      // Create new location if not found
      location = await this.createCompanyLocation(companyId, data);
    } else {
      console.log(`📍 Found existing location: ${location.name} (ID: ${location.externalId})`);
    }
    
    return location;
  }

  /**
   * Assign customer to location if not already assigned
   * @param {string} companyContactId - The company contact ID
   * @param {string} locationId - The location ID
   * @param {string} role - The role for the assignment
   * @returns {Promise<Object|null>} Assignment result or null if already assigned
   */
  async assignCustomerToLocationIfNeeded(companyContactId, locationId, role = 'MEMBER') {
    // Check if customer is already assigned to this location
    const isAssigned = await this.isCustomerAssignedToLocation(companyContactId, locationId);
    
    if (isAssigned) {
      console.log(`ℹ️  Customer already assigned to location`);
      return null;
    }
    
    // Assign customer to location
    return await this.assignCustomerToLocation(companyContactId, locationId, role);
  }
}

module.exports = ShopifyService; 