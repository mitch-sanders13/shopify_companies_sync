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
 * - Syncs metadata fields from Google Sheets to Shopify
 * - Handles duplicate prevention and error recovery
 * 
 * Metadata Fields Synced:
 * Company Level:
 * - custom.price_level (from priceLevel column L)
 * - custom.payment_terms (from terms column M)
 * - custom.currency_code (from currencyCode column N)
 * - custom.sales_rep (from salesRep column O)
 * 
 * Location Level:
 * - custom.location_price_level (from priceLevel column L)
 * - custom.location_payment_terms (from terms column M)
 * - custom.location_currency_code (from currencyCode column N)
 * - custom.location_sales_rep (from salesRep column O)
 * 
 * Metadata is stored at both company and location levels and is
 * automatically updated when Google Sheets data changes.
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
      query findCompany {
        companies(first: 50) {
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
      const data = await this.executeQuery(query, {});

      const companies = data.companies.edges;
      
      // Filter companies to find the one with matching external ID
      const matchingCompany = companies.find(edge => 
        edge.node.externalId === trimmedExternalId
      );
      
      if (matchingCompany) {
        console.log(`✅ Found existing company: "${matchingCompany.node.name}" (ID: ${matchingCompany.node.externalId})`);
        return matchingCompany.node;
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

      const company = data.companyCreate.company;
      console.log('✅ Company created successfully');

      // Add metadata fields after creation
      await this.setCompanyMetafields(company.id, companyData);
      console.log('✅ Company metadata added successfully');

      return company;
    } catch (error) {
      console.error('❌ Error creating company:', error);
      throw error;
    }
  }

  /**
   * Update an existing company's metadata in Shopify
   * @param {string} companyId - The Shopify company ID
   * @param {Object} companyData - Company information from spreadsheet
   * @returns {Promise<Object>} Updated company object
   */
  async updateCompany(companyId, companyData) {
    const mutation = `
      mutation companyUpdate($companyId: ID!, $input: CompanyInput!) {
        companyUpdate(companyId: $companyId, input: $input) {
          company {
            id
            name
            externalId
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
      name: companyData.companyName,
      note: `Updated via sync from Google Sheets\nCompany ID: ${companyData.companyId}\nSync Date: ${new Date().toISOString()}`
    };

    try {
      console.log(`🏢 Updating company: ${companyData.companyName} (ID: ${companyData.companyId})`);
      
      const data = await this.executeQuery(mutation, { companyId, input });
      
      if (data.companyUpdate.userErrors?.length > 0) {
        throw new Error(`Company update errors: ${JSON.stringify(data.companyUpdate.userErrors)}`);
      }

      const company = data.companyUpdate.company;
      console.log('✅ Company updated successfully');

      // Update metadata fields
      await this.setCompanyMetafields(company.id, companyData);
      console.log('✅ Company metadata updated successfully');

      return company;
    } catch (error) {
      console.error('❌ Error updating company:', error);
      throw error;
    }
  }

  /**
   * Set metafields for a company using the metafieldsSet mutation
   * @param {string} companyId - The Shopify company ID
   * @param {Object} companyData - Company data from spreadsheet
   * @returns {Promise<void>}
   */
  async setCompanyMetafields(companyId, companyData) {
    const metafields = this.buildCompanyMetafields(companyData);
    
    if (metafields.length === 0) {
      console.log('📝 No company metadata to set');
      return;
    }

    // Add ownerId to each metafield
    const metafieldsWithOwner = metafields.map(metafield => ({
      ...metafield,
      ownerId: companyId
    }));

    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            key
            namespace
            value
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
      console.log(`📝 Setting ${metafields.length} company metafields...`);
      
      const data = await this.executeQuery(mutation, { metafields: metafieldsWithOwner });
      
      if (data.metafieldsSet.userErrors?.length > 0) {
        throw new Error(`Company metafields errors: ${JSON.stringify(data.metafieldsSet.userErrors)}`);
      }

      console.log(`✅ Successfully set ${data.metafieldsSet.metafields.length} company metafields`);
    } catch (error) {
      console.error('❌ Error setting company metafields:', error);
      throw error;
    }
  }

  /**
   * Set metafields for a location using the metafieldsSet mutation
   * @param {string} locationId - The Shopify location ID
   * @param {Object} locationData - Location data from spreadsheet
   * @returns {Promise<void>}
   */
  async setLocationMetafields(locationId, locationData) {
    const metafields = this.buildLocationMetafields(locationData);
    
    if (metafields.length === 0) {
      console.log('📝 No location metadata to set');
      return;
    }

    // Add ownerId to each metafield
    const metafieldsWithOwner = metafields.map(metafield => ({
      ...metafield,
      ownerId: locationId
    }));

    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            key
            namespace
            value
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
      console.log(`📝 Setting ${metafields.length} location metafields...`);
      
      const data = await this.executeQuery(mutation, { metafields: metafieldsWithOwner });
      
      if (data.metafieldsSet.userErrors?.length > 0) {
        throw new Error(`Location metafields errors: ${JSON.stringify(data.metafieldsSet.userErrors)}`);
      }

      console.log(`✅ Successfully set ${data.metafieldsSet.metafields.length} location metafields`);
    } catch (error) {
      console.error('❌ Error setting location metafields:', error);
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
   * Find the default company location (the one created automatically by Shopify)
   * @param {string} companyId - The Shopify company ID
   * @returns {Promise<Object|null>} Default location object or null
   */
  async findDefaultCompanyLocation(companyId) {
    const query = `
      query findDefaultLocation($companyId: ID!) {
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
      // Find location with no external ID (the default one created by Shopify)
      const defaultLocation = locations.find(edge => 
        edge.node.externalId === null || edge.node.externalId === ""
      );
      
      return defaultLocation ? defaultLocation.node : null;
    } catch (error) {
      console.error('❌ Error finding default location:', error);
      return null;
    }
  }

  /**
   * Update an existing company location
   * @param {string} locationId - The Shopify location ID to update
   * @param {Object} locationData - Location information from spreadsheet
   * @returns {Promise<Object>} Updated location object
   */
  async updateCompanyLocation(locationId, locationData) {
    const mutation = `
      mutation companyLocationUpdate($companyLocationId: ID!, $input: CompanyLocationUpdateInput!) {
        companyLocationUpdate(companyLocationId: $companyLocationId, input: $input) {
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
      note: `Updated via sync from Google Sheets\nLocation ID: ${locationData.locationId}\nAddress: ${locationData.address}, ${locationData.city}, ${locationData.state} ${locationData.zip}\nSync Date: ${new Date().toISOString()}`
    };

    try {
      console.log(`📍 Updating location: ${input.name} (ID: ${locationData.locationId})`);
      
      const data = await this.executeQuery(mutation, { companyLocationId: locationId, input });
      
      if (data.companyLocationUpdate.userErrors?.length > 0) {
        throw new Error(`Location update errors: ${JSON.stringify(data.companyLocationUpdate.userErrors)}`);
      }

      const location = data.companyLocationUpdate.companyLocation;
      console.log('✅ Location updated successfully');

      // Update metadata fields
      await this.setLocationMetafields(location.id, locationData);
      console.log('✅ Location metadata updated successfully');

      return location;
    } catch (error) {
      console.error('❌ Error updating location:', error);
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

      const location = data.companyLocationCreate.companyLocation;
      console.log('✅ Location created successfully');

      // Add metadata fields after creation
      await this.setLocationMetafields(location.id, locationData);
      console.log('✅ Location metadata added successfully');

      return location;
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
      
      // Check if we need to update metadata (always update to ensure latest data)
      console.log(`🔄 Updating company metadata for latest changes...`);
      company = await this.updateCompany(company.id, data);
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
    // First try to find existing location by external ID
    let location = await this.findLocationByExternalId(companyId, data.locationId);
    
    if (!location) {
      // Check if this is the first location and if there's a default location we can update
      const defaultLocation = await this.findDefaultCompanyLocation(companyId);
      
      if (defaultLocation && data.locationId === '1') {
        console.log(`📍 Found default company location, updating it with location data...`);
        location = await this.updateCompanyLocation(defaultLocation.id, data);
      } else {
        // Create new location if not found
        location = await this.createCompanyLocation(companyId, data);
      }
    } else {
      console.log(`📍 Found existing location: ${location.name} (ID: ${location.externalId})`);
      
      // Update metadata for existing locations to ensure latest data
      console.log(`🔄 Updating location metadata for latest changes...`);
      location = await this.updateCompanyLocation(location.id, data);
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

  /**
   * Debug method to list all locations for a company
   * @param {string} companyId - The Shopify company ID
   */
  async debugListAllLocations(companyId) {
    const query = `
      query debugListLocations($companyId: ID!) {
        company(id: $companyId) {
          name
          externalId
          locations(first: 50) {
            edges {
              node {
                id
                name
                externalId
                createdAt
                updatedAt
                shippingAddress {
                  address1
                  city
                  province
                  zip
                }
              }
            }
          }
        }
      }
    `;

    try {
      console.log(`🔍 DEBUG: Listing all locations for company...`);
      const data = await this.executeQuery(query, { companyId });
      
      if (data.company && data.company.locations.edges.length > 0) {
        console.log(`🏢 Company: ${data.company.name} (External ID: ${data.company.externalId})`);
        console.log(`📍 Total locations found: ${data.company.locations.edges.length}`);
        
        data.company.locations.edges.forEach((edge, index) => {
          const location = edge.node;
          console.log(`   ${index + 1}. ${location.name}`);
          console.log(`      - Shopify ID: ${location.id}`);
          console.log(`      - External ID: ${location.externalId}`);
          console.log(`      - Address: ${location.shippingAddress?.address1}, ${location.shippingAddress?.city}`);
          console.log(`      - Created: ${location.createdAt}`);
          console.log(`      - Updated: ${location.updatedAt}`);
        });
      } else {
        console.log(`📭 No locations found for company`);
      }
    } catch (error) {
      console.error('❌ Error listing locations:', error);
    }
  }

  /**
   * Build metafields array for company metadata
   * NOTE: Companies do not have native payment terms fields in Shopify.
   * Payment terms are applied to individual orders, not companies directly.
   * This metafield stores the payment terms to be used when creating orders for this company.
   * @param {Object} companyData - Company data from spreadsheet
   * @returns {Array} Array of metafield objects
   */
  buildCompanyMetafields(companyData) {
    const metafields = [];
    
    // Price Level metafield - format as JSON array for list type
    if (companyData.priceLevel && companyData.priceLevel.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'price_level',
        value: JSON.stringify([companyData.priceLevel.trim()])
      });
    }
    
    // Payment Terms metafield - format as JSON array for list type
    // This will be used when creating orders for this company
    if (companyData.terms && companyData.terms.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'payment_terms',
        value: JSON.stringify([companyData.terms.trim()])
      });
    }
    
    // Currency Code metafield - format as JSON array for list type
    if (companyData.currencyCode && companyData.currencyCode.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'currency_code',
        value: JSON.stringify([companyData.currencyCode.trim()])
      });
    }
    
    // Sales Rep metafield - format as JSON array for list type
    if (companyData.salesRep && companyData.salesRep.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'sales_rep',
        value: JSON.stringify([companyData.salesRep.trim()])
      });
    }
    
    return metafields;
  }

  /**
   * Build metafields array for location metadata
   * NOTE: Company locations do not have native payment terms fields in Shopify.
   * Payment terms are applied to individual orders, not locations directly.
   * These metafields store the payment terms to be used when creating orders for this location.
   * @param {Object} locationData - Location data from spreadsheet
   * @returns {Array} Array of metafield objects
   */
  buildLocationMetafields(locationData) {
    const metafields = [];
    
    // Price Level metafield - single choice value (for choice/dropdown field)
    if (locationData.priceLevel && locationData.priceLevel.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'location_price_level',
        value: locationData.priceLevel.trim()
      });
    }
    
    // Payment Terms metafield - format as JSON array for list type
    // This will be used when creating orders for this location
    if (locationData.terms && locationData.terms.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'location_payment_terms',
        value: JSON.stringify([locationData.terms.trim()])
      });
    }
    
    // Currency Code metafield - format as JSON array for list type
    if (locationData.currencyCode && locationData.currencyCode.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'location_currency_code',
        value: JSON.stringify([locationData.currencyCode.trim()])
      });
    }
    
    // Sales Rep metafield - format as JSON array for list type
    if (locationData.salesRep && locationData.salesRep.trim() !== '') {
      metafields.push({
        namespace: 'custom',
        key: 'location_sales_rep',
        value: JSON.stringify([locationData.salesRep.trim()])
      });
    }
    
    return metafields;
  }

  /**
   * Helper method to prepare payment terms data for order creation
   * This method extracts payment terms from company/location metafields
   * and formats them for use with Shopify's native payment terms API
   * @param {Object} companyData - Company data with payment terms
   * @param {Object} locationData - Location data with payment terms (optional)
   * @returns {Object|null} Payment terms data ready for order creation, or null if no terms
   */
  preparePaymentTermsForOrder(companyData, locationData = null) {
    // Priority: Location payment terms > Company payment terms
    let paymentTerms = null;
    
    if (locationData && locationData.terms && locationData.terms.trim() !== '') {
      paymentTerms = locationData.terms.trim();
    } else if (companyData && companyData.terms && companyData.terms.trim() !== '') {
      paymentTerms = companyData.terms.trim();
    }
    
    if (!paymentTerms) {
      return null;
    }
    
    // Map payment terms text to Shopify payment terms template names
    // This mapping should be customized based on your payment terms templates in Shopify
    const paymentTermsMapping = {
      'Net 30': 'Net 30',
      'Net 15': 'Net 15', 
      'Net 60': 'Net 60',
      'COD': 'Cash on Delivery',
      'Prepaid': 'Payment in advance'
    };
    
    const mappedTerms = paymentTermsMapping[paymentTerms] || paymentTerms;
    
    return {
      paymentTermsName: mappedTerms,
      // You may need to adjust this based on your payment terms templates
      // Common types: RECEIPT, NET, FIXED_DATE
      paymentTermsType: 'NET'
    };
  }

  /**
   * Create payment terms for an order (to be used when creating orders)
   * This method should be called after creating an order to apply payment terms
   * @param {string} orderId - The Shopify order ID
   * @param {Object} paymentTermsData - Payment terms data from preparePaymentTermsForOrder
   * @returns {Promise<Object>} Created payment terms object
   */
  async createOrderPaymentTerms(orderId, paymentTermsData) {
    if (!paymentTermsData) {
      console.log('📝 No payment terms to apply to order');
      return null;
    }

    const mutation = `
      mutation paymentTermsCreate($referenceId: ID!, $paymentTermsAttributes: PaymentTermsCreateInput!) {
        paymentTermsCreate(referenceId: $referenceId, paymentTermsAttributes: $paymentTermsAttributes) {
          paymentTerms {
            id
            paymentTermsName
            paymentTermsType
            dueInDays
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      console.log(`📝 Creating payment terms for order: ${paymentTermsData.paymentTermsName}`);
      
      const data = await this.executeQuery(mutation, { 
        referenceId: orderId,
        paymentTermsAttributes: paymentTermsData
      });
      
      if (data.paymentTermsCreate.userErrors?.length > 0) {
        throw new Error(`Payment terms creation errors: ${JSON.stringify(data.paymentTermsCreate.userErrors)}`);
      }

      const paymentTerms = data.paymentTermsCreate.paymentTerms;
      console.log(`✅ Successfully created payment terms: ${paymentTerms.paymentTermsName}`);
      
      return paymentTerms;
    } catch (error) {
      console.error('❌ Error creating payment terms for order:', error);
      // Don't throw error - payment terms creation failure shouldn't break the sync
      return null;
    }
  }
}

module.exports = ShopifyService; 