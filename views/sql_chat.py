import streamlit as st
from sql_chat_agent import page_sql_chat

page_sql_chat(st.session_state.get("df"))
