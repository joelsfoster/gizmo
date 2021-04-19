<template>
  <v-container>
    <v-row>
      <v-col>
        <v-card class="mx-auto my-12" max-width="500">
          <template slot="progress">
            <v-progress-linear
              color="deep-purple"
              height="10"
              indeterminate
            ></v-progress-linear>
          </template>

          <v-img
            height="250"
            :src="require('../assets/Crypto_Bot_Logo.jpg')"
          ></v-img>

          <div class="text-xs-center">
            <h1 class="text-xs-center">Gizmo Settings</h1>
          </div>
          <v-divider class="ma-4"></v-divider>

          <v-card-text class="ma-4">
            <v-container class="grey lighten-5 mb-6">
              <v-row no-gutters style="height: 150px">
                <v-col align-center>
                  <h1>Exchange:</h1>
                </v-col>
                <v-col>
                  <h1>{{ botSetup.exchange }}</h1>
                </v-col>
              </v-row>
              <v-row no-gutters style="height: 150px">
                <v-col align-center>
                  <h1>Ticker Base:</h1>
                </v-col>
                <v-col>
                  <v-select
                    v-model="botSetup.ticker_base"
                    :items="coinOptions"
                    dense
                  ></v-select>
                </v-col>
              </v-row>
              <v-row no-gutters style="height: 150px">
                <v-col align-center>
                  <h1>Ticker Quote:</h1>
                </v-col>
                <v-col>
                  <v-select
                    v-model="botSetup.ticker_quote"
                    :items="quoteOptions"
                    dense
                  ></v-select>
                </v-col>
              </v-row>
              <v-row no-gutters style="height: 150px">
                <v-col align-center>
                  <h1>Mode:</h1>
                </v-col>
                <v-col>
                  <v-select
                    v-model="botSetup.test_mode"
                    :items="modeOptions"
                    item-text="display"
                    item-value="value"
                    dense
                  ></v-select>
                </v-col>
              </v-row>
              <v-col justify-center>
                <v-btn class="black--text" @click="updateBotSettings">
                  Update Bot Settings
                </v-btn>
              </v-col>
            </v-container>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col>
        <v-card>
          <div class="datatable-container">
<!--             <v-btn class="black--text" @click="sendTestLong">
              Sent Test Long Trigger
            </v-btn>
             <v-btn class="black--text" @click="sendTestShort">
              Sent Test Short Trigger
            </v-btn> -->
            <v-data-table
              :headers="headers"
              :items="trades"
              class="elevation-1 tableStyling roundedCorners"
            >
              <template v-slot:item="{ item }">
                <tr>
                  <td>{{ formatDateTime(item.tradeTime) }}</td>
                  <td>{{ item.enterPrice }}</td>
                  <td>{{ item.action }}</td>
                  <td>{{ item.order_type }}</td>
                  <td>{{ item.leverage }}</td>
                  <td>{{ item.ltpp }}</td>
                  <td>{{ item.slp }}</td>
                  <td>{{ item.tslp }}</td>
                  
                </tr>
              </template>
            </v-data-table>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
import axios from "axios";
import config from '../../public/config.json';

export default {
  name: "Hello",
  data() {
    return {
      headers: [
        {
          text: "Trade Time",
          value: "tradeTime",
          align: "center",
          class: "black--text",
        },
         {
          text: "Enter Price",
          value: "enterPrice",
          align: "center",
          class: "black--text",
        },
        {
          text: "Action",
          value: "action",
          align: "center",
          class: "black--text",
        },
        {
          text: "Order Type",
          value: "order_type",
          align: "center",
          class: "black--text",
        },
        {
          text: "Leverage",
          value: "leverage",
          align: "center",
          class: "black--text",
        },
        {
          text: "LTPP",
          value: "ltpp",
          align: "center",
          class: "black--text",
        },
        {
          text: "SLP",
          value: "slp",
          align: "center",
          class: "black--text",
        },
        {
          text: "TSLP",
          value: "tslp",
          align: "center",
          class: "black--text",
        },
      ],
      botSetup: {
        ticker_base: "BTC",
        ticker_quote: "USD",
        exchange: "bybit",
        test_mode: true,
      },
      coinOptions: ["BTC", "ETH", "EOS", "XRP"],
      quoteOptions: ["USD", "USDT"],
      modeOptions: [
        { display: "Live", value: false },
        { display: "Test", value: true },
      ],
      trades: [],
      timer: ""
    };
  },
  methods: {
    async sendTestLong() {
      var alert = {
        auth_id: "testId",
        action: "reverse_short_to_long",
        ltpp: [1.0],
        order_type: "market",
        slp: "4.5",
        leverage: "10",
      };
      try {
        await axios
          .post(config.gizmoUrl +"/placeTrade", alert)
          .then((response) => {
            console.log(response);
          });
      } catch (err) {
        console.log(err);
      }
    },
    async sendTestShort() {
      var alert = {
        auth_id: "testId",
        action: "reverse_long_to_short",
        ltpp: [0.65],
        tslp: "4.5",
        order_type: "market",
        leverage: "10",
      };
      try {
        await axios
          .post(config.gizmoUrl +"/placeTrade", alert)
          .then((response) => {
            console.log(response);
          });
      } catch (err) {
        console.log(err);
      }
    },
    async getTrades() {
      try {
        await axios.get(config.gizmoUrl + "/getTrades").then((response) => {
          this.trades = response.data;
        });
      } catch (err) {
        console.log(err);
      }
    },
    async updateBotSettings() {
      try {
        await axios
          .post(config.gizmoUrl + "/updateBotSetup", this.botSetup)
          .then((response) => {
            console.log(response);
          });
      } catch (err) {
        console.log(err);
      }
    },

    async getBotSetup() {
      try {
        await axios
          .get(config.gizmoUrl +"/getBotSetup")
          .then((response) => {
            this.botSetup = response.data;
            if (this.botSetup.test_mode) {
              this.botSetup.mode = "Test";
            } else {
              this.botSetup.mode = "Live";
            }
          });
      } catch (err) {
        console.log(err);
      }
    },
    formatDateTime (dateToFormat) {
      var dateFormat = require('dateformat');
      var formattedDate = new Date(dateToFormat);
      return dateFormat(formattedDate, 'yyyy-mm-dd HH:MM:ss.L');
    }
  },
  beforeMount() {
    this.getTrades();
    this.getBotSetup();
    this.timer = setInterval(this.getTrades, 5000);

    
  },
};
</script>
