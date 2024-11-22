const express = require('express');
const axios = require('axios');
const qs = require('querystring');
const crypto = require('crypto'); // To generate random state strings

const app = express();

// Configuration for your QuickBooks app
const clientId = 'ABRJTQ4dR43hWwyTSTiwC1n8E7suExD0XpwVoQsvdu7MPfqLtW'; // Replace with your app's Client ID
const clientSecret = '2pChmqkYU1wM6jVFxtHRzJwGoMejYQ45r8WWFbKo'; // Replace with your app's Client Secret
const redirectUri = 'http://localhost:5000/callback'; // Replace with your Redirect URI
const sandboxCompanyId = '9341453379095730'; // Replace with your company ID

let accessToken = ''; // Access token will be dynamically fetched
let refreshToken = ''; // Token used for refreshing access token
let oauthState = ''; // Temporary storage for the state parameter

// Generate a random state string
const generateState = () => crypto.randomBytes(16).toString('hex');

// Route to start OAuth process
app.get('/auth', (req, res) => {
    oauthState = generateState(); // Generate a unique state for this session

    const authUrl = `https://appcenter.intuit.com/connect/oauth2?` +
        `client_id=${clientId}` +
        `&response_type=code` +
        `&scope=com.intuit.quickbooks.accounting` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${oauthState}`;

    console.log('Redirecting to authorization URL:', authUrl);
    res.redirect(authUrl);
});

// Callback route to handle Intuit's response
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
        return res.send('Authorization failed: No authorization code provided.');
    }

    if (state !== oauthState) {
        return res.send('Authorization failed: Invalid state parameter.');
    }

    try {
        // Exchange authorization code for access and refresh tokens
        const tokenResponse = await axios.post(
            'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            qs.stringify({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                },
            }
        );

        accessToken = tokenResponse.data.access_token;
        refreshToken = tokenResponse.data.refresh_token;

        console.log('Access Token:', accessToken);
        console.log('Refresh Token:', refreshToken);

        res.send('Authorization successful! Tokens have been saved.');
    } catch (error) {
        console.error('Error during token exchange:', error.message);
        res.send('Authorization failed: Unable to exchange tokens.');
    }
});

// Route to refresh access token
app.get('/refresh-token', async (req, res) => {
    if (!refreshToken) {
        return res.send('Refresh failed: No refresh token available.');
    }

    try {
        const refreshResponse = await axios.post(
            'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            qs.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                },
            }
        );

        accessToken = refreshResponse.data.access_token;
        refreshToken = refreshResponse.data.refresh_token;

        console.log('New Access Token:', accessToken);
        console.log('New Refresh Token:', refreshToken);

        res.send('Token refreshed successfully!');
    } catch (error) {
        console.error('Error during token refresh:', error.message);
        res.send('Token refresh failed.');
    }
});

const { Pool } = require('pg'); // Import PostgreSQL client

// PostgreSQL connection configuration
const pool = new Pool({
    user: 'nalyons1', // Replace with your Azure PostgreSQL username
    host: 'lyonsledger.postgres.database.azure.com', // Replace with your host
    database: 'QBOAPI1', // Replace with your database name
    password: 'Bozo#0427', // Replace with your password
    port: 5432, // Default PostgreSQL port
    ssl: {
        rejectUnauthorized: false, // Ensure secure connection
    },
});

// Route to fetch Chart of Accounts and insert into PostgreSQL
app.get('/chart-of-accounts', async (req, res) => {
    if (!accessToken) {
        return res.send('Connection failed: No access token.');
    }

    try {
        const query = "SELECT * FROM Account";
        const response = await axios.get(
            `https://sandbox-quickbooks.api.intuit.com/v3/company/${sandboxCompanyId}/query`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                },
                params: { query },
            }
        );

        if (response.status === 200) {
            const accounts = response.data.QueryResponse.Account || [];

            // Create a JavaScript object array ("DataFrame"-like structure)
            const accountsDataFrame = accounts.map(account => ({
                id: account.Id,
                name: account.Name,
                type: account.AccountType,
                subType: account.AccountSubType || 'N/A',
            }));

            // Insert accounts into PostgreSQL
            const client = await pool.connect();
            try {
                // Clear the table to avoid duplicates (optional)
                await client.query('DELETE FROM chart_of_accounts');

                // Insert each account
                for (const account of accountsDataFrame) {
                    await client.query(
                        'INSERT INTO chart_of_accounts (account_id, name, type, subtype) VALUES ($1, $2, $3, $4)',
                        [account.id, account.name, account.type, account.subType]
                    );
                }

                console.log('Accounts successfully inserted into PostgreSQL');
                res.send(`Connection Successful! Accounts: ${accountsDataFrame.map(a => a.name).join(', ')}`);
            } catch (dbError) {
                console.error('Database error:', dbError.message);
                res.send('Connection successful, but failed to insert data into PostgreSQL.');
            } finally {
                client.release();
            }
        } else {
            res.send('Connection Failed. Got a response.');
        }
    } catch (error) {
        console.error('Error during connection check:', error.message);
        res.send('Connection Failed. Error.');
    }
});

// Root route
app.get('/', (req, res) => {
    res.send('Hello! Use /auth to start the authentication process.');
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
