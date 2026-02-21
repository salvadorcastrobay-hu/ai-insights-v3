import streamlit as st
from src.agents.chat_agent import page_sql_chat

page_sql_chat(st.session_state.get("df"))
